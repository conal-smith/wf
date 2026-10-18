"""A forecast manifest list has to name both platforms the Mac mini and CI run.

    python3 -m unittest discover -s scripts/release -p 'test_*.py'
"""

import io
import unittest

import manifest_platforms as manifest


INDEX = {
    "schemaVersion": 2,
    "mediaType": "application/vnd.oci.image.index.v1+json",
    "digest": "sha256:" + "ab" * 32,
    "manifests": [
        {
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "digest": "sha256:" + "11" * 32,
            "platform": {"architecture": "amd64", "os": "linux"},
        },
        {
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "digest": "sha256:" + "22" * 32,
            "platform": {"architecture": "arm64", "os": "linux", "variant": "v8"},
        },
        {
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "digest": "sha256:" + "33" * 32,
            "annotations": {
                "vnd.docker.reference.digest": "sha256:" + "11" * 32,
                "vnd.docker.reference.type": "attestation-manifest",
            },
            "platform": {"architecture": "unknown", "os": "unknown"},
        },
    ],
}


class ManifestPlatformTests(unittest.TestCase):
    def test_an_index_satisfies_linux_arm64_when_the_variant_is_v8(self):
        self.assertEqual(manifest.missing(INDEX, ["linux/amd64", "linux/arm64"]), [])
        self.assertEqual(manifest.platforms(INDEX), ["linux/amd64", "linux/arm64/v8"])

    def test_an_attestation_is_not_a_platform(self):
        self.assertNotIn("unknown/unknown", manifest.platforms(INDEX))

    def test_a_list_without_arm64_is_what_the_mac_mini_refuses(self):
        amd64 = {
            "manifests": [
                {"platform": {"os": "linux", "architecture": "amd64"}},
            ],
        }
        self.assertEqual(manifest.missing(amd64, ["linux/amd64", "linux/arm64"]), ["linux/arm64"])

    def test_a_single_image_manifest_has_no_platforms(self):
        self.assertEqual(manifest.platforms({"schemaVersion": 2, "config": {}}), [])
        self.assertEqual(manifest.missing({}, ["linux/amd64"]), ["linux/amd64"])

    def test_digest_is_the_index_digest(self):
        self.assertEqual(manifest.digest(INDEX), INDEX["digest"])

    def test_digest_refuses_raw_registry_json_that_omits_it(self):
        with self.assertRaises(SystemExit):
            manifest.digest({"manifests": INDEX["manifests"]})

    def test_check_command_reads_stdin_and_fails_closed(self):
        self.assertEqual(manifest.main(["check", self._stdin(INDEX), "linux/amd64", "linux/arm64"]), 0)
        self.assertEqual(manifest.main(["check", self._stdin({"manifests": []}), "linux/arm64"]), 1)
        self.assertEqual(manifest.main(["digest"]), 2)

    def _stdin(self, document):
        sys_stdin = __import__("sys").stdin
        __import__("sys").stdin = io.StringIO(__import__("json").dumps(document))
        self.addCleanup(lambda: setattr(__import__("sys"), "stdin", sys_stdin))
        return "-"


if __name__ == "__main__":
    unittest.main()
