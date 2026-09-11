import { render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import App from "../../src/playground/App.vue";

describe("playground", () => {
  it("identifies the project and logical layers", () => {
    render(App);

    expect(screen.getByRole("heading", { name: "Vue Dependency Graph" })).toBeTruthy();
    expect(screen.getByText("core")).toBeTruthy();
    expect(screen.getByText("vue:core")).toBeTruthy();
    expect(screen.getByText("devtools:core")).toBeTruthy();
  });
});
