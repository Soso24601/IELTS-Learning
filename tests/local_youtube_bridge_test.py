import importlib.util
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen


spec = importlib.util.spec_from_file_location("local_youtube_bridge", Path(__file__).resolve().parents[1] / "tools/local-youtube-bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTest(unittest.TestCase):
    def test_rejects_invalid_video_id_without_running_downloader(self):
        with self.assertRaisesRegex(ValueError, "视频链接无效"):
            bridge.download_audio("../../private", Path("/tmp"))

    def test_only_site_origin_can_request_fixed_video_id_and_audio(self):
        server = bridge.ThreadingHTTPServer(("127.0.0.1", 0), bridge.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"

        def fake_download(video_id, directory):
            self.assertEqual(video_id, "h2ou2A_-8JU")
            path = directory / "audio.webm"
            path.write_bytes(b"audio" * 300)
            return path

        try:
            with patch.object(bridge, "download_audio", fake_download):
                unauthorized = Request(base + "/audio", data=b'{"videoId":"h2ou2A_-8JU"}', headers={"Origin": "https://evil.example", "Content-Type": "application/json"})
                with self.assertRaises(HTTPError) as error:
                    urlopen(unauthorized, timeout=3)
                self.assertEqual(error.exception.code, 403)

                authorized = Request(base + "/audio", data=b'{"videoId":"h2ou2A_-8JU"}', headers={"Origin": "https://ielts.grincaq.info", "Content-Type": "application/json"})
                with urlopen(authorized, timeout=3) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.headers["Content-Type"], "audio/webm")
                    self.assertEqual(response.read(), b"audio" * 300)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
