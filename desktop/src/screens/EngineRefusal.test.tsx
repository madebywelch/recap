// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import EngineRefusal from "./EngineRefusal";

afterEach(cleanup);

it("offers a next step without exposing raw error details", () => {
  render(<EngineRefusal message="private engine error" />);
  expect(screen.getByText(/Try reinstalling the app/)).toBeTruthy();
  expect(screen.queryByText("private engine error")).toBeNull();
});
