use std::env;
use std::path::PathBuf;
use std::process::Command;

/// Finds a bundled tool next to the app's executable, falling back to PATH.
fn tool_path(name: &str) -> PathBuf {
    let file = format!("{name}{}", env::consts::EXE_SUFFIX);
    if let Some(dir) = env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)) {
        let bundled = dir.join(&file);
        if bundled.exists() {
            return bundled;
        }
    }
    PathBuf::from(file)
}

pub fn command(name: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(tool_path(name));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Software encoders the frontend can offer, plus hardware encoders that
/// actually work on this machine rather than merely being compiled in.
pub fn available_encoders() -> Vec<String> {
    let listing = command("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let compiled: Vec<&str> = listing
        .lines()
        .filter_map(|line| line.split_whitespace().nth(1))
        .collect();

    let software = ["libx264", "libx265", "libsvtav1", "libvpx-vp9"];
    let hardware = [
        "h264_videotoolbox",
        "hevc_videotoolbox",
        "h264_nvenc",
        "hevc_nvenc",
        "av1_nvenc",
        "h264_qsv",
        "hevc_qsv",
        "h264_amf",
        "hevc_amf",
    ];

    let mut found: Vec<String> = software
        .iter()
        .filter(|e| compiled.contains(e))
        .map(|e| e.to_string())
        .collect();
    for encoder in hardware.iter().filter(|e| compiled.contains(e)) {
        let works = command("ffmpeg")
            .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"])
            .arg("color=s=640x360:d=0.2")
            .args(["-frames:v", "2", "-pix_fmt", "yuv420p", "-c:v", encoder, "-f", "null", "-"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if works {
            found.push(encoder.to_string());
        }
    }
    found
}
