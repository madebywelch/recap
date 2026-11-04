import { describe, expect, it } from "vitest";
import { EnvelopeError, SUPPORTED_ENGINE_MAJOR } from "./fixtures";
import { classifyLaunchFailure } from "./store";

/**
 * The engine-handshake enforcement (docs/desktop-app-spec.md §Engine
 * contract): a launch scan that fails contract validation must refuse the
 * app, not degrade into the fixture fallback — the classification here is
 * the only thing standing between a mismatched engine and a silently
 * wrong-looking app.
 */
describe("classifyLaunchFailure", () => {
  it("refuses on a version-handshake failure", () => {
    const failure = classifyLaunchFailure(
      new EnvelopeError(
        `engine version ${SUPPORTED_ENGINE_MAJOR + 1}.0 is newer than this app understands (major ${SUPPORTED_ENGINE_MAJOR}); refusing to render`,
      ),
    );
    expect(failure.refusal).toContain("newer than this app understands");
    expect(failure.error).toBeUndefined();
  });

  it("refuses on any contract violation, not just the version", () => {
    const failure = classifyLaunchFailure(new EnvelopeError("envelope must be an object"));
    expect(failure.refusal).toBe("envelope must be an object");
    expect(failure.error).toBeUndefined();
  });

  it("treats every other failure as a scan error for the fixture fallback", () => {
    expect(classifyLaunchFailure(new Error("sidecar spawn failed"))).toEqual({
      error: "sidecar spawn failed",
    });
    expect(classifyLaunchFailure("no such file")).toEqual({ error: "no such file" });
  });
});
