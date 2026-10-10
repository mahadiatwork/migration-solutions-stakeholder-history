import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import MoveToMatterButton from "./MoveToMatterButton";

test("opens the Matter selector directly", () => {
  const onClick = jest.fn();

  render(<MoveToMatterButton onClick={onClick} />);
  fireEvent.click(screen.getByRole("button", { name: "Move to Matter" }));

  expect(onClick).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Move the saved history?")).toBeNull();
});
