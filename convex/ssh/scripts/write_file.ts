/** Fixed remote program that performs a metadata-checked atomic replacement and reports uncertain outcomes. */
export const writeFileScript = `import base64, errno, fcntl, json, os, secrets, signal, stat, sys

LIMIT = 524288
class Refused(Exception):
    pass

def stop(signum, frame):
    raise Refused("deadline_exceeded")
signal.signal(signal.SIGALRM, stop)
signal.signal(signal.SIGHUP, stop)
signal.signal(signal.SIGTERM, stop)
signal.alarm(45)

def parent(path):
    parts = path.split("/")
    if parts[0] != "" or any(p in ("", ".", "..") for p in parts[1:]):
        raise Refused("invalid_request")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in parts[1:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = next_fd
        return fd, parts[-1]
    except BaseException:
        os.close(fd)
        raise

def identity(s):
    return (s.st_dev, s.st_ino, s.st_size, s.st_uid, s.st_gid, s.st_mode, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)

def snapshot(fd):
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise Refused("unsupported_file")
    if before.st_size > LIMIT:
        raise Refused("too_large")
    os.lseek(fd, 0, os.SEEK_SET)
    data = bytearray()
    while len(data) <= LIMIT:
        chunk = os.read(fd, min(32768, LIMIT + 1 - len(data)))
        if not chunk:
            break
        data.extend(chunk)
    if len(data) > LIMIT:
        raise Refused("too_large")
    attrs = {name: os.getxattr(fd, name) for name in os.listxattr(fd)}
    after = os.fstat(fd)
    if identity(before) != identity(after) or len(data) != after.st_size:
        raise Refused("changed")
    return bytes(data), after, attrs

def open_file(directory, name):
    return os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)

def check_path(path, directory, before):
    checked_parent, checked_name = parent(path)
    try:
        a, b = os.fstat(directory), os.fstat(checked_parent)
        if (a.st_dev, a.st_ino) != (b.st_dev, b.st_ino):
            raise Refused("changed")
        current_path = os.stat(checked_name, dir_fd=checked_parent, follow_symlinks=False)
        if identity(current_path) != identity(before):
            raise Refused("changed")
    finally:
        os.close(checked_parent)

def perform(request):
    global replaced
    expected = base64.b64decode(request["expected"], validate=True)
    candidate = base64.b64decode(request["candidate"], validate=True)
    if max(len(expected), len(candidate)) > LIMIT:
        raise Refused("too_large")
    directory, name = parent(request["path"])
    original = temporary = None
    temp_name = None
    try:
        try:
            fcntl.flock(directory, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused("busy")
        original = open_file(directory, name)
        data, before, attrs = snapshot(original)
        expected_attrs = request["attributes"]
        actual_attrs = dict(size=before.st_size, uid=before.st_uid, gid=before.st_gid,
                            mode=before.st_mode, mtime=before.st_mtime_ns // 1000000000)
        if data != expected or actual_attrs != expected_attrs:
            raise Refused("changed")
        if data == candidate:
            check_path(request["path"], directory, before)
            return "unchanged"
        proposed_name = ".composery-write-" + secrets.token_hex(16)
        temporary = os.open(proposed_name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                            0o600, dir_fd=directory)
        temp_name = proposed_name
        offset = 0
        while offset < len(candidate):
            written = os.write(temporary, candidate[offset:])
            if written <= 0:
                raise Refused("write_failed")
            offset += written
        os.fchown(temporary, before.st_uid, before.st_gid)
        os.fchmod(temporary, stat.S_IMODE(before.st_mode))
        for attr in os.listxattr(temporary):
            if attr not in attrs:
                os.removexattr(temporary, attr)
        for attr, value in attrs.items():
            os.setxattr(temporary, attr, value)
        staged, staged_stat, staged_attrs = snapshot(temporary)
        if (staged != candidate or staged_attrs != attrs or
            (staged_stat.st_uid, staged_stat.st_gid, staged_stat.st_mode) !=
            (before.st_uid, before.st_gid, before.st_mode)):
            raise Refused("metadata_not_preserved")
        os.fsync(temporary)
        current, current_stat, current_attrs = snapshot(original)
        if current != expected or identity(current_stat) != identity(before) or current_attrs != attrs:
            raise Refused("changed")
        check_path(request["path"], directory, before)
        replaced = True
        os.replace(temp_name, name, src_dir_fd=directory, dst_dir_fd=directory)
        temp_name = None
        os.fsync(directory)
        verified_parent, verified_name = parent(request["path"])
        try:
            verified = open_file(verified_parent, verified_name)
            try:
                content, final, final_attrs = snapshot(verified)
                if (content != candidate or final_attrs != attrs or
                    (final.st_dev, final.st_ino) != (staged_stat.st_dev, staged_stat.st_ino) or
                    (final.st_uid, final.st_gid, final.st_mode) !=
                    (before.st_uid, before.st_gid, before.st_mode)):
                    raise Refused("verification_failed")
            finally:
                os.close(verified)
        finally:
            os.close(verified_parent)
        return "written"
    finally:
        try:
            if temp_name is not None:
                os.unlink(temp_name, dir_fd=directory)
        finally:
            for descriptor in (temporary, original, directory):
                if descriptor is not None:
                    try:
                        os.close(descriptor)
                    except OSError:
                        pass

replaced = False
try:
    raw = sys.stdin.buffer.read(1500001)
    if len(raw) > 1500000:
        raise Refused("too_large")
    result = perform(json.loads(raw))
except Refused as error:
    result = "uncertain" if replaced else str(error)
except OSError as error:
    result = "uncertain" if replaced else {
        errno.ENOENT: "file_missing", errno.EACCES: "permission_denied",
        errno.EPERM: "permission_denied", errno.ELOOP: "unsupported_file",
        errno.ENOTDIR: "unsupported_file", errno.ENOTSUP: "unsupported_file",
    }.get(error.errno, "write_failed")
except Exception:
    result = "uncertain" if replaced else "write_failed"
signal.alarm(0)
print(result, flush=True)
`;
