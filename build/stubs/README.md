# Engine stubs

`build.mjs` swaps these modules into the three engine bundles (`engine.mjs`, `engine.js`, `engine-offline.js`) in place of LikeC4 dependencies that the engine's code path never runs. Each file says why its module is unused. A stubbed function that should never run throws instead of returning a fake value.

`test/engine-bundle.test.mjs` fails if a removed package comes back into a built engine. When a LikeC4 upgrade starts calling one of these functions, the engine throws `not available in architecture-diagrams`: then remove the stub (and its marker in the test) rather than extending it.
