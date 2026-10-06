import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  HOLD_FEEDBACK_MS,
  LONG_PRESS_MS,
  haptic,
  settle,
  useDrag,
  useLongPress,
  type DragRelease,
} from "./gestures";

const touch = { pointerType: "touch", pointerId: 1, button: 0 } as const;

function Held({
  onLongPress,
  onClick,
}: {
  onLongPress: () => void;
  onClick: () => void;
}) {
  const { holding, bind } = useLongPress({ onLongPress });
  return (
    <button type="button" onClick={onClick} {...bind}>
      {holding ? "Holding" : "Row"}
    </button>
  );
}

function Dragged({
  axis = "x",
  direction = 0,
  onRelease,
  onClick,
}: {
  axis?: "x" | "y";
  direction?: -1 | 0 | 1;
  onRelease: (release: DragRelease) => void;
  onClick: () => void;
}) {
  const { offset, dragging, bind } = useDrag({ axis, direction, onRelease });
  return (
    <div {...bind} data-testid="surface">
      <button type="button" onClick={onClick}>
        {dragging ? `Dragging ${offset}` : "Card"}
      </button>
    </div>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("press and hold", () => {
  it("opens the options once a finger has been held still long enough", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(<Held onLongPress={onLongPress} onClick={onClick} />);
    const row = screen.getByRole("button");

    fireEvent.pointerDown(row, { ...touch, clientX: 10, clientY: 10 });
    // Not at once: the first moments of a press may yet become a scroll.
    expect(row).toHaveTextContent("Row");
    act(() => vi.advanceTimersByTime(HOLD_FEEDBACK_MS));
    expect(row).toHaveTextContent("Holding");
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS - HOLD_FEEDBACK_MS - 1));
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(row).toHaveTextContent("Row");

    // The lift that ends the hold is not also a tap on the row.
    fireEvent.pointerUp(row, touch);
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("leaves a quick tap a tap", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(<Held onLongPress={onLongPress} onClick={onClick} />);
    const row = screen.getByRole("button");

    fireEvent.pointerDown(row, { ...touch, clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(120));
    fireEvent.pointerUp(row, touch);
    fireEvent.click(row);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("gives way to a scroll: moving past the slop cancels the hold", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    render(<Held onLongPress={onLongPress} onClick={() => {}} />);
    const row = screen.getByRole("button");

    fireEvent.pointerDown(row, { ...touch, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(row, { ...touch, clientX: 10, clientY: 40 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("stops when the browser takes the pointer for itself", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    render(<Held onLongPress={onLongPress} onClick={() => {}} />);
    const row = screen.getByRole("button");

    fireEvent.pointerDown(row, { ...touch, clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(row, touch);
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("does not turn a held mouse button into options; a right click does that", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    render(<Held onLongPress={onLongPress} onClick={() => {}} />);
    const row = screen.getByRole("button");

    fireEvent.pointerDown(row, {
      pointerType: "mouse",
      pointerId: 1,
      button: 0,
    });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(onLongPress).not.toHaveBeenCalled();

    const menu = fireEvent.contextMenu(row);
    expect(menu).toBe(false); // the browser's own menu is held back
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("opens once when Android reports its own long press as well", () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    render(<Held onLongPress={onLongPress} onClick={() => {}} />);
    const row = screen.getByRole("button");

    fireEvent.pointerDown(row, { ...touch, clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    fireEvent.contextMenu(row);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("never swallows a keyboard press after the menu key opened the options", async () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    render(<Held onLongPress={onLongPress} onClick={onClick} />);
    const row = screen.getByRole("button");

    row.focus();
    fireEvent.contextMenu(row);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("dragging along one axis", () => {
  it("follows the finger sideways and reports where it let go", () => {
    const onRelease = vi.fn();
    const onClick = vi.fn();
    render(<Dragged onRelease={onRelease} onClick={onClick} />);
    const surface = screen.getByTestId("surface");

    fireEvent.pointerDown(surface, { ...touch, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { ...touch, clientX: 160, clientY: 104 });
    expect(screen.getByRole("button")).toHaveTextContent("Dragging 60");
    fireEvent.pointerMove(surface, { ...touch, clientX: 220, clientY: 104 });
    fireEvent.pointerUp(surface, { ...touch, clientX: 220, clientY: 104 });

    expect(onRelease).toHaveBeenCalledTimes(1);
    expect(onRelease.mock.calls[0]![0].offset).toBe(120);
    expect(screen.getByRole("button")).toHaveTextContent("Card");

    // The drag ended over the button, which must not also be pressed.
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("leaves the other axis alone, so the screen still scrolls", () => {
    const onRelease = vi.fn();
    render(<Dragged onRelease={onRelease} onClick={() => {}} />);
    const surface = screen.getByTestId("surface");

    fireEvent.pointerDown(surface, { ...touch, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { ...touch, clientX: 106, clientY: 160 });
    fireEvent.pointerMove(surface, { ...touch, clientX: 180, clientY: 170 });
    fireEvent.pointerUp(surface, { ...touch, clientX: 180, clientY: 170 });
    expect(onRelease).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toHaveTextContent("Card");
  });

  it("keeps a tap a tap", async () => {
    const onRelease = vi.fn();
    const onClick = vi.fn();
    render(<Dragged onRelease={onRelease} onClick={onClick} />);
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("drops a drag the browser cancels", () => {
    const onRelease = vi.fn();
    render(<Dragged onRelease={onRelease} onClick={() => {}} />);
    const surface = screen.getByTestId("surface");

    fireEvent.pointerDown(surface, { ...touch, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(surface, { ...touch, clientX: 160, clientY: 100 });
    fireEvent.pointerCancel(surface, touch);
    expect(screen.getByRole("button")).toHaveTextContent("Card");
    fireEvent.pointerUp(surface, { ...touch, clientX: 160, clientY: 100 });
    expect(onRelease).not.toHaveBeenCalled();
  });

  it("meets resistance against its one direction", () => {
    render(
      <Dragged
        axis="y"
        direction={1}
        onRelease={() => {}}
        onClick={() => {}}
      />,
    );
    const surface = screen.getByTestId("surface");

    fireEvent.pointerDown(surface, { ...touch, clientX: 100, clientY: 300 });
    fireEvent.pointerMove(surface, { ...touch, clientX: 100, clientY: 200 });
    expect(screen.getByRole("button")).toHaveTextContent("Dragging -15");
  });
});

describe("settling a released drag", () => {
  it("commits past the distance, either way", () => {
    expect(settle({ offset: 130, velocity: 0 }, 120)).toBe(1);
    expect(settle({ offset: -130, velocity: 0 }, 120)).toBe(-1);
  });

  it("springs back short of it", () => {
    expect(settle({ offset: 60, velocity: 0.1 }, 120)).toBe(0);
    expect(settle({ offset: 0, velocity: 2 }, 120)).toBe(0);
  });

  it("commits a flick, but only the way the drag went", () => {
    expect(settle({ offset: 40, velocity: 0.8 }, 120)).toBe(1);
    expect(settle({ offset: 40, velocity: -0.8 }, 120)).toBe(0);
  });

  it("does not mistake a twitch for a flick", () => {
    expect(settle({ offset: 12, velocity: 3 }, 120)).toBe(0);
  });
});

describe("haptics", () => {
  it("ticks where the phone can", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    haptic();
    expect(vibrate).toHaveBeenCalledWith(10);
    vi.unstubAllGlobals();
  });

  it("is simply nothing where it cannot, as on an iPhone", () => {
    vi.stubGlobal("navigator", { ...navigator, vibrate: undefined });
    expect(() => haptic()).not.toThrow();
    vi.unstubAllGlobals();
  });
});
