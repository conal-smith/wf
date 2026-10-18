"""The forecast image refuses a node binary or wheel for the other architecture.

    python -m unittest force5.ingest.test_check_native_arch
"""

import unittest

from check_native_arch import EM_AARCH64, EM_X86_64, elf_machine, problems


def elf(machine):
    header = bytearray(20)
    header[0:4] = b"\x7fELF"
    header[18:20] = machine.to_bytes(2, "little")
    return bytes(header)


def packages(machine):
    return {name: [elf(machine)] for name in ("numpy", "pyproj", "eccodeslib")}


class NativeArchTests(unittest.TestCase):
    def test_elf_machine_ignores_anything_that_is_not_elf(self):
        self.assertIsNone(elf_machine(b"not elf"))
        self.assertIsNone(elf_machine(b"\x7fELF"))
        self.assertEqual(elf_machine(elf(EM_AARCH64)), EM_AARCH64)

    def test_each_platform_accepts_only_its_own_binaries(self):
        self.assertEqual(problems("arm64", "arm64", elf(EM_AARCH64), packages(EM_AARCH64)), [])
        self.assertEqual(problems("amd64", "x64", elf(EM_X86_64), packages(EM_X86_64)), [])

    def test_an_amd64_wheel_or_node_is_refused_in_an_arm64_image(self):
        found = problems("arm64", "x64", elf(EM_X86_64), packages(EM_X86_64))
        self.assertTrue(any("node process.arch" in line for line in found))
        self.assertTrue(any("numpy" in line for line in found))

    def test_a_missing_native_library_is_refused(self):
        wheels = packages(EM_AARCH64)
        wheels["eccodeslib"] = [b"not a library"]
        found = problems("arm64", "arm64", elf(EM_AARCH64), wheels)
        self.assertEqual(found, ["eccodeslib has no native library for linux/arm64"])

    def test_an_unknown_architecture_is_refused(self):
        found = problems("", "x64", elf(EM_X86_64), packages(EM_X86_64))
        self.assertIn("unset", found[0])


if __name__ == "__main__":
    unittest.main()
