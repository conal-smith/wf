"""Refuse a forecast image whose native binaries are the wrong architecture.

force5/Dockerfile runs this after pip and the node copy. buildx sets TARGETARCH
to amd64 or arm64 and builds every stage for that platform; pip then selects the
matching manylinux wheel and the node binary comes from that platform's
node:22-slim. This is the backstop for a cross build that installed the other
CPU's esbuild package, wheel, or node.

    TARGETARCH=arm64 python force5/ingest/check_native_arch.py

Standard library only, so the image can run it before anything else is trusted.
"""

import os
import pathlib
import site
import subprocess
import sys

# ELF e_machine. linux/arm64 images are EM_AARCH64; a v8 variant does not change it.
EM_X86_64 = 62
EM_AARCH64 = 183
# Wheels the importers actually load. A pure-Python stand-in for one of these
# would pass pip and then fail on the Mac mini.
REQUIRED_PACKAGES = ("numpy", "pyproj", "eccodeslib")
NODE = pathlib.Path("/usr/local/bin/node")


def elf_machine(header):
    """ELF e_machine from the start of a file, or None when it is not an ELF."""
    if len(header) < 20 or header[:4] != b"\x7fELF":
        return None
    return int.from_bytes(header[18:20], "little")


def expected(targetarch):
    """(e_machine, node process.arch) for a Docker TARGETARCH, or None."""
    return {"amd64": (EM_X86_64, "x64"), "arm64": (EM_AARCH64, "arm64")}.get(targetarch)


def problems(targetarch, node_arch, node_header, packages):
    """Human-readable mismatches. `packages` maps a distribution to ELF headers.

    An empty list means node and every required package match `targetarch`.
    A header that is not ELF is ignored, except when a required package then
    has no ELF library at all.
    """
    want = expected(targetarch)
    if want is None:
        return [f"force5 image supports linux/amd64 and linux/arm64 (TARGETARCH={targetarch or 'unset'})"]
    want_machine, want_node = want
    found = []
    if node_arch != want_node:
        found.append(f"node process.arch is {node_arch or 'unknown'}, image is linux/{targetarch}")
    machine = elf_machine(node_header)
    if machine is None:
        found.append("node is not an ELF binary")
    elif machine != want_machine:
        found.append(f"node e_machine={machine}, image is linux/{targetarch}")
    for name in REQUIRED_PACKAGES:
        headers = packages.get(name) or []
        machines = [elf_machine(header) for header in headers]
        machines = [item for item in machines if item is not None]
        if not machines:
            found.append(f"{name} has no native library for linux/{targetarch}")
            continue
        wrong = [item for item in machines if item != want_machine]
        if wrong:
            found.append(f"{name} e_machine={wrong[0]}, image is linux/{targetarch}")
    return found


def _site_packages():
    for entry in site.getsitepackages():
        path = pathlib.Path(entry)
        if path.is_dir():
            return path
    version = f"python{sys.version_info.major}.{sys.version_info.minor}"
    return pathlib.Path(sys.prefix) / "lib" / version / "site-packages"


def _package_headers(root):
    headers = []
    if not root.is_dir():
        return headers
    for path in sorted(root.rglob("*.so")):
        headers.append(path.read_bytes()[:20])
    return headers


def main():
    targetarch = os.environ.get("TARGETARCH", "")
    node_arch = ""
    node_header = b""
    if NODE.is_file():
        node_header = NODE.read_bytes()[:20]
        node_arch = subprocess.check_output([str(NODE), "-p", "process.arch"], text=True).strip()
    packages = {
        name: _package_headers(_site_packages() / name)
        for name in REQUIRED_PACKAGES
    }
    found = problems(targetarch, node_arch, node_header, packages)
    if found:
        print("forecast image native binaries do not match the build platform:", file=sys.stderr)
        for line in found:
            print(f"  {line}", file=sys.stderr)
        return 1
    print(f"native binaries match linux/{targetarch}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
