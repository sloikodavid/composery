use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::path::Path;

#[cfg(unix)]
use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Command {
    Status,
    Doctor,
    Prune,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub version: u8,
    pub command: Command,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub version: u8,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn ok<T: Serialize>(payload: &T) -> Result<Self> {
        Ok(Self {
            version: 1,
            ok: true,
            payload: Some(serde_json::to_value(payload).context("encode response payload")?),
            error: None,
        })
    }

    pub fn error(error: impl ToString) -> Self {
        Self {
            version: 1,
            ok: false,
            payload: None,
            error: Some(error.to_string()),
        }
    }

    pub fn decode_payload<T: DeserializeOwned>(self) -> Result<T> {
        if !self.ok {
            bail!(
                "{}",
                self.error.unwrap_or_else(|| "daemon command failed".into())
            );
        }
        let payload = self.payload.context("daemon response missing payload")?;
        serde_json::from_value(payload).context("decode daemon response payload")
    }
}

pub fn request<T: DeserializeOwned>(socket: &Path, command: Command) -> Result<T> {
    #[cfg(not(unix))]
    {
        let _ = (socket, command);
        bail!("persistd control socket is only supported on Unix");
    }

    #[cfg(unix)]
    {
        let mut stream =
            UnixStream::connect(socket).with_context(|| format!("connect {}", socket.display()))?;
        let request = Request {
            version: 1,
            command,
        };
        serde_json::to_writer(&mut stream, &request).context("encode daemon request")?;
        stream.write_all(b"\n").context("finish daemon request")?;
        stream.flush().context("flush daemon request")?;

        let mut line = String::new();
        BufReader::new(stream)
            .read_line(&mut line)
            .context("read daemon response")?;
        if line.is_empty() {
            bail!("daemon closed the control socket without a response");
        }

        let response: Response = serde_json::from_str(&line).context("decode daemon response")?;
        response.decode_payload()
    }
}

#[cfg(test)]
mod tests {
    use super::{Command, Request, Response};

    #[test]
    fn request_protocol_is_json_line_friendly() {
        let request = Request {
            version: 1,
            command: Command::Status,
        };

        let encoded = serde_json::to_string(&request).unwrap();

        assert_eq!(encoded, r#"{"version":1,"command":"status"}"#);
    }

    #[test]
    fn response_decodes_typed_payload() {
        let response = Response::ok(&serde_json::json!({"ready": true})).unwrap();

        let payload: serde_json::Value = response.decode_payload().unwrap();

        assert_eq!(payload["ready"], true);
    }
}
