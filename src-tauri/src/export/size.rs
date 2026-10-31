/// Below this, encoders stop honoring the target and quality is useless anyway.
pub const MIN_VIDEO_KBPS: u32 = 16;
const SAFETY_MARGIN: f64 = 0.97;
pub const MIN_GIF_WIDTH: u32 = 64;

pub fn limit_bytes(max_mb: f64) -> u64 {
    (max_mb * 1_000_000.0) as u64
}

pub fn audio_bytes(audio_kbps: Option<u32>, duration: f64) -> f64 {
    audio_kbps.unwrap_or(0) as f64 * 1000.0 / 8.0 * duration
}

/// Video bitrate that leaves room for audio and a safety margin.
pub fn initial_kbps(limit: u64, audio_kbps: Option<u32>, duration: f64) -> u32 {
    let budget = limit as f64 * SAFETY_MARGIN - audio_bytes(audio_kbps, duration);
    let kbps = budget * 8.0 / duration / 1000.0;
    (kbps as i64).max(MIN_VIDEO_KBPS as i64) as u32
}

/// Scales the bitrate down after an oversized result. Returns nothing once the
/// bitrate can't usefully go lower.
pub fn next_kbps(
    current: u32,
    size: u64,
    limit: u64,
    audio_kbps: Option<u32>,
    duration: f64,
) -> Option<u32> {
    let audio = audio_bytes(audio_kbps, duration);
    let video_size = (size as f64 - audio).max(1.0);
    let room = limit as f64 * SAFETY_MARGIN - audio;
    let next = (current as f64 * (room / video_size).max(0.0) * 0.97) as u32;
    if current <= MIN_VIDEO_KBPS {
        None
    } else {
        Some(next.clamp(MIN_VIDEO_KBPS, current - 1))
    }
}

/// Searches for the largest GIF width under the limit. Size grows roughly with
/// the square of the width, so guesses interpolate on that curve.
#[derive(Debug, Default)]
pub struct GifSearch {
    fits: Option<(u32, u64)>,
    over: Option<(u32, u64)>,
}

impl GifSearch {
    pub fn record(&mut self, width: u32, size: u64, limit: u64) {
        if size <= limit {
            if self.fits.is_none_or(|(w, _)| width > w) {
                self.fits = Some((width, size));
            }
        } else if self.over.is_none_or(|(w, _)| width < w) {
            self.over = Some((width, size));
        }
    }

    pub fn next_width(&self, limit: u64) -> Option<u32> {
        let even = |w: f64| (w as u32) & !1;
        match (self.fits, self.over) {
            (Some((_, size)), _) if size as f64 >= limit as f64 * 0.92 => None,
            (Some((lo, lo_size)), Some((hi, hi_size))) => {
                if hi - lo <= 8 {
                    return None;
                }
                let span = (hi_size - lo_size).max(1) as f64;
                let t = ((limit as f64 * 0.97 - lo_size as f64) / span).clamp(0.1, 0.9);
                let (lo2, hi2) = ((lo as f64).powi(2), (hi as f64).powi(2));
                let width = even((lo2 + (hi2 - lo2) * t).sqrt());
                (width > lo && width < hi).then_some(width)
            }
            (None, Some((hi, size))) => {
                if hi <= MIN_GIF_WIDTH {
                    return None;
                }
                let guess = hi as f64 * (limit as f64 / size as f64).sqrt() * 0.97;
                Some(even(guess).clamp(MIN_GIF_WIDTH, hi - 2))
            }
            _ => None,
        }
    }

    pub fn best_width(&self) -> Option<u32> {
        self.fits.map(|(w, _)| w)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bitrate_leaves_room_for_audio_and_margin() {
        // 10 MB over 60s with 128k audio: 9.7 MB budget less 0.96 MB audio.
        let kbps = initial_kbps(limit_bytes(10.0), Some(128), 60.0);
        assert_eq!(kbps, 1165);
    }

    #[test]
    fn impossible_targets_use_the_floor_rather_than_going_negative() {
        assert_eq!(initial_kbps(1000, Some(320), 600.0), MIN_VIDEO_KBPS);
    }

    #[test]
    fn retry_lowers_the_bitrate_in_proportion() {
        let limit = limit_bytes(10.0);
        let next = next_kbps(1000, limit + limit / 5, limit, None, 60.0).unwrap();
        assert!((750..800).contains(&next), "{next}");
    }

    #[test]
    fn retry_stops_at_the_floor() {
        assert_eq!(next_kbps(MIN_VIDEO_KBPS, 5000, 1000, None, 10.0), None);
    }

    #[test]
    fn retry_always_makes_progress() {
        let next = next_kbps(100, 1001, 1000, None, 1.0).unwrap();
        assert!(next < 100);
    }

    #[test]
    fn gif_search_converges_on_a_simulated_encoder() {
        let size_at = |w: u32| (w as u64).pow(2) * 40;
        let limit = 2_000_000;
        let mut search = GifSearch::default();
        let mut width = Some(1280);
        let mut encodes = 0;
        while let Some(w) = width {
            encodes += 1;
            assert!(encodes <= 5, "too many encodes");
            search.record(w, size_at(w), limit);
            if encodes == 5 {
                break;
            }
            width = search.next_width(limit);
        }
        let best = search.best_width().unwrap();
        assert!(size_at(best) <= limit);
        assert!(best > 180, "settled too low: {best}");
    }

    #[test]
    fn gif_search_gives_up_at_the_minimum_width() {
        let mut search = GifSearch::default();
        search.record(MIN_GIF_WIDTH, 10_000, 1000);
        assert_eq!(search.next_width(1000), None);
        assert_eq!(search.best_width(), None);
    }
}
