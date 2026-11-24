// Shared by the engine stubs: a stubbed function that should never run fails loudly.
export function unavailable(name) {
  return function () {
    throw new Error(`${name} is not available in architecture-diagrams (stubbed at build time, see build/stubs)`)
  }
}
