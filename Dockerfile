# Node major is pinned by the IDE (engines + VS Code remote/.npmrc target), whose
# native modules are built for this ABI. The builder and runtime must share it, so it
# lives in one ARG; bump both together when the IDE moves to a new Node major.
ARG NODE_IMAGE=node:22-trixie-slim@sha256:e637ac91fb4f2f40761d217c5d48c41a05edf0b65eb9c34e72c27cce55af9e65

# Build the IDE from the in-repo hard fork of code-server.
FROM ${NODE_IMAGE} AS ide-builder

# Apt packages are intentionally unpinned: the Debian suite comes from the base
# image, and the image digest is the reproducibility boundary.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    git \
    git-lfs \
    jq \
    libkrb5-dev \
    libsecret-1-dev \
    libx11-dev \
    libxkbfile-dev \
    patch \
    pkg-config \
    python-is-python3 \
    quilt \
    rsync \
    unzip \
  && rm -rf /var/lib/apt/lists/*

# The IDE build runs code-server's own toolchain (npm ci / npm run build) inside
# the cloned upstream tree, so no pnpm or workspace root is needed here.
WORKDIR /src

# Copy the IDE package: overlay, patches, series, and build.sh.
COPY packages/ide ./packages/ide

WORKDIR /src/packages/ide

# Clone pristine code-server at the pinned commit (the submodule .gitmodules is for
# local dev; in Docker there's no git context after COPY, so fetch directly). It
# brings its own VS Code submodule.
# renovate: datasource=git-tags depName=coder/code-server versioning=semver
ARG CODE_SERVER_COMMIT=871f1d904834ee78db1c4585e2f14f65c119374a
RUN git init -q upstream \
  && git -C upstream remote add origin https://github.com/coder/code-server.git \
  && git -C upstream fetch --depth 1 origin "${CODE_SERVER_COMMIT}" \
  && git -C upstream checkout -q FETCH_HEAD \
  && git -C upstream submodule update --init --recursive --depth 1

# Lay our overlay + patches over pristine code-server and build the release.
RUN ./build.sh

RUN printf 'source=https://github.com/coder/code-server\ncommit=%s\n' "${CODE_SERVER_COMMIT}" \
    > build/release/.composery-upstream

# Build the Composery CLI. cargo-chef caches the dependency compile so source-only edits skip it.
FROM rust:1.96.0-slim-trixie@sha256:26abcef3d79b8d890c4ceb17093154573e1f6479cf6dd7c1450043b8458350f6 AS cli-chef
# renovate: datasource=crate depName=cargo-chef
ARG CARGO_CHEF_VERSION=0.1.77
RUN cargo install cargo-chef --version "${CARGO_CHEF_VERSION}" --locked
WORKDIR /src/cli

FROM cli-chef AS cli-planner
COPY packages/cli/ .
RUN cargo chef prepare --recipe-path /recipe.json

FROM cli-chef AS cli-builder
COPY --from=cli-planner /recipe.json /recipe.json
RUN cargo chef cook --release --recipe-path /recipe.json
COPY packages/cli/ .
RUN cargo build --release --locked --bin composery \
  && install -D target/release/composery /out/composery

# Assemble the runtime image.
FROM ${NODE_IMAGE} AS runtime

ARG COMPOSERY_BUILD_VERSION=unknown
ARG COMPOSERY_BUILD_REVISION=unknown
ARG COMPOSERY_BUILD_SOURCE=https://github.com/sloikodavid/composery

LABEL org.opencontainers.image.title="Composery" \
  org.opencontainers.image.description="A persistent VPS-like Linux appliance with code-server in the browser." \
  org.opencontainers.image.source="${COMPOSERY_BUILD_SOURCE}" \
  org.opencontainers.image.revision="${COMPOSERY_BUILD_REVISION}" \
  org.opencontainers.image.version="${COMPOSERY_BUILD_VERSION}" \
  org.opencontainers.image.licenses="Apache-2.0"

# renovate: datasource=npm depName=bun
ARG BUN_VERSION=1.3.14
# renovate: datasource=npm depName=npm
ARG NPM_VERSION=11.17.0
# renovate: datasource=npm depName=pnpm
ARG PNPM_VERSION=11.7.0

ENV COMPOSERY_BUILD_VERSION="${COMPOSERY_BUILD_VERSION}" \
  COMPOSERY_BUILD_REVISION="${COMPOSERY_BUILD_REVISION}" \
  COMPOSERY_BUILD_SOURCE="${COMPOSERY_BUILD_SOURCE}" \
  BROWSER="/opt/code-server/current/lib/vscode/bin/helpers/browser.sh" \
  EDITOR="code --wait" \
  GIT_EDITOR="code --wait" \
  KUBE_EDITOR="code --wait" \
  LANG="C.UTF-8" \
  VISUAL="code --wait" \
  XDG_RUNTIME_DIR="/run/user/1000"
# LANG gives a UTF-8 default; LC_ALL is intentionally not pinned so the user can
# override the locale per session (a pinned LC_ALL overrides every LC_* and LANG,
# which would prevent that). A deployment-provided LC_ALL is still honored.

# Put the user's standard bin dirs on PATH at the process level, not just in
# interactive shells, so binaries on ~/.local/bin work everywhere that inherits
# this environment: integrated terminals, and shells an AI agent or task spawns
# (including `bash -c`/sandboxed commands, which source no startup files and so
# rely on inherited PATH). Interactive login shells layer rc-file PATH edits
# (cargo, rustup, ...) on top of this.
ENV PATH="/home/user/.local/bin:/home/user/bin:${PATH}"

# Apt packages are intentionally unpinned: the Debian suite comes from the base
# image, and the image digest is the reproducibility boundary. APT lists are kept
# so `sudo apt install` works out of the box in this VPS-like appliance; `apt
# update` refreshes them, and persistence persists any changes.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    age \
    bash \
    ca-certificates \
    cron \
    curl \
    desktop-file-utils \
    git \
    jq \
    less \
    libfile-mimeinfo-perl \
    mailcap \
    nano \
    openssh-client \
    procps \
    python3 \
    ripgrep \
    shared-mime-info \
    sudo \
    supervisor \
    systemd \
    tar \
    tmux \
    unzip \
    vim-tiny \
    wget \
    xdg-user-dirs \
    xdg-utils \
    xz-utils \
    zip \
    zstd

# cron's PAM stack fails `session required pam_loginuid.so` in an unprivileged
# container (no writable /proc/self/loginuid), which silently stops cron jobs from
# running even though the daemon is up. Make it optional so `crontab` works.
RUN sed -i 's/session\s\+required\s\+pam_loginuid/session optional pam_loginuid/' /etc/pam.d/cron

RUN npm install --global \
    "bun@${BUN_VERSION}" \
    "npm@${NPM_VERSION}" \
    "pnpm@${PNPM_VERSION}" \
  && npm cache clean --force

RUN groupmod --new-name user node \
  && usermod --login user --home /home/user --move-home node \
  && mkdir -p /home/user

COPY --from=ide-builder /src/packages/ide/build/release /opt/code-server/current
COPY --from=cli-builder /out/composery /opt/composery/bin/composery
COPY rootfs/ /

# Show only the working directory in the interactive prompt (~/Desktop, not
# user@<container-id>:~/Desktop). The stock Debian skel ~/.bashrc (moved from
# /home/node) sets the user@host prompt; the last PS1 assignment wins, so
# appending here overrides it. Captured in the persistence baseline below.
RUN printf '%s\n' \
    '' \
    '# Composery: show only the working directory in the prompt.' \
    'PS1='\''${debian_chroot:+($debian_chroot)}\[\033[01;34m\]\w\[\033[00m\]\$ '\''' \
    >> /home/user/.bashrc

# Final runtime wiring: create the user's standard bin dirs (so login shells add
# them to PATH via the stock ~/.profile even before anything is installed), fix
# ownership (home, and /usr/local so the user can install globally without sudo),
# permissions, unit symlinks, and desktop/mime caches, then snapshot the baseline
# persistence restores from.
RUN find /home/user -name .gitkeep -type f -delete \
  && mkdir -p /data /etc/systemd/system/multi-user.target.wants \
  && mkdir -p /home/user/.local/bin /home/user/bin \
  && rm -f /etc/machine-id \
  && touch /etc/machine-id \
  && chown -R user:user /home/user \
  && chmod 0440 /etc/sudoers.d/user \
  && chmod +x /opt/composery/entrypoint.sh \
  && chmod +x /opt/composery/code-server.sh \
  && chmod +x /opt/composery/init/*.sh \
  && chmod +x /usr/local/bin/xclip /usr/local/bin/xsel /usr/local/bin/wl-paste /usr/local/bin/wl-copy \
  && rm -f /etc/systemd/system/multi-user.target.wants/supervisor.service \
  && ln -sf /dev/null /etc/systemd/system/systemd-modules-load.service \
  && ln -sf ../persistence.service /etc/systemd/system/multi-user.target.wants/persistence.service \
  && ln -sf ../composery.service /etc/systemd/system/multi-user.target.wants/composery.service \
  && ln -sf /opt/code-server/current/lib/vscode/bin/remote-cli/code-server /usr/local/bin/code \
  && ln -sf /opt/code-server/current/bin/code-server /usr/local/bin/code-server \
  && ln -sf /opt/composery/bin/composery /usr/local/bin/composery \
  && update-desktop-database /usr/share/applications \
  && update-mime-database /usr/share/mime \
  && chown -R user:user /usr/local \
  && /opt/composery/bin/composery persistence __generate-baseline --root / --output /opt/persistence/baseline.sqlite

# No USER directive: persistence needs root to rebuild the filesystem on boot; supervisor
# drops to the unprivileged `user` for code-server. Root is intentional.
EXPOSE 8080

# Liveness against code-server's auth-exempt /healthz; PORT comes from the container env.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT:-8080}/healthz" > /dev/null || exit 1

ENTRYPOINT ["/opt/composery/entrypoint.sh"]
