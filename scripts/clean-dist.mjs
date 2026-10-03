import { rmSync } from "node:fs";

// Cross-platform stand-in for `rm -rf dist`, so a build never ships stale
// output from a previous layout.
rmSync(new URL("../dist", import.meta.url), { recursive: true, force: true });
