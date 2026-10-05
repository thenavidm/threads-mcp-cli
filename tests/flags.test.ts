import { describe, expect, it } from "vitest";
// `--port` for --http is Slipway's now, and tested there; these are the flags this repo still parses.
import { numericFlag } from "../src/config.js";
import { loginOptionsFrom } from "../src/auth/login.js";

describe("numericFlag", () => {
  it("reads the equals form", () => {
    expect(numericFlag(["--port=9001"], "port", 8787)).toBe(9001);
  });

  // The regression this file exists for: only the equals form parsed, so
  // `--port 9001` silently bound the default and looked like a broken flag.
  it("reads the space form", () => {
    expect(numericFlag(["--port", "9001"], "port", 8787)).toBe(9001);
  });

  it("falls back when the flag is absent", () => {
    expect(numericFlag(["--http"], "port", 8787)).toBe(8787);
  });

  it("falls back rather than binding NaN on a typo", () => {
    expect(numericFlag(["--port", "eight"], "port", 8787)).toBe(8787);
    expect(numericFlag(["--port=0"], "port", 8787)).toBe(8787);
    expect(numericFlag(["--port=-1"], "port", 8787)).toBe(8787);
  });

  it("falls back when the space form has nothing after it", () => {
    expect(numericFlag(["--port"], "port", 8787)).toBe(8787);
  });

  it("does not match a flag that merely starts the same way", () => {
    expect(numericFlag(["--portable=1"], "port", 8787)).toBe(8787);
  });
});

describe("loginOptionsFrom", () => {
  it("takes either spelling of --port", () => {
    expect(loginOptionsFrom(["--port=9000"]).port).toBe(9000);
    expect(loginOptionsFrom(["--port", "9000"]).port).toBe(9000);
  });

  it("defaults to 8788", () => {
    expect(loginOptionsFrom([]).port).toBe(8788);
    expect(loginOptionsFrom(["--manual"]).port).toBe(8788);
  });

  it("still reads the other flags", () => {
    expect(loginOptionsFrom(["--manual"]).manual).toBe(true);
    expect(loginOptionsFrom(["--port", "9000", "--all-scopes"]).scopes.length).toBeGreaterThan(
      loginOptionsFrom([]).scopes.length,
    );
  });
});
