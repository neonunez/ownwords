import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./core/Button";
import { Chip } from "./core/Chip";
import { IconButton } from "./core/IconButton";
import { StateLabel } from "./core/StateLabel";
import { Switch } from "./core/Switch";
import { MasteryMeter } from "./content/MasteryMeter";
import { SegmentedControl } from "./navigation/SegmentedControl";
import { TabBar } from "./navigation/TabBar";
import { TopBar } from "./navigation/TopBar";
import { Card } from "./content/Card";

describe("state is always written in words", () => {
  it("writes a false friend out, and does not rely on colour", () => {
    render(<StateLabel state="false-friend" />);
    expect(screen.getByText("false friend")).toBeInTheDocument();
  });

  it("writes a hand-typed equivalent out", () => {
    render(<StateLabel state="manual" />);
    expect(screen.getByText("typed by hand")).toBeInTheDocument();
  });

  it("says so when a direction has never been practised", () => {
    render(
      <MasteryMeter
        recognise={0.74}
        produce={null}
        label="Mastery in Español"
      />,
    );
    expect(
      screen.getByRole("img", {
        name: "Mastery in Español: recognise 74%, produce not practised yet",
      }),
    ).toBeInTheDocument();
  });
});

describe("controls are real controls", () => {
  it("gives an icon button a name a screen reader can read", () => {
    render(<IconButton name="plus" label="Add an entry" />);
    expect(
      screen.getByRole("button", { name: "Add an entry" }),
    ).toBeInTheDocument();
  });

  it("hides the icon itself from assistive technology", () => {
    const { container } = render(
      <IconButton name="plus" label="Add an entry" />,
    );
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("reports a chip as pressed when it is the chosen filter", () => {
    render(<Chip selected>Unverified</Chip>);
    expect(screen.getByRole("button", { name: "Unverified" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("exposes a switch with its state", async () => {
    const onChange = vi.fn();
    render(
      <Switch
        checked={false}
        label="Suggest translations"
        onChange={onChange}
      />,
    );
    const control = screen.getByRole("switch", {
      name: "Suggest translations",
    });
    expect(control).toHaveAttribute("aria-checked", "false");
    await userEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("does not fire a disabled button", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Translate
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Translate" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders a card that does something as a button", () => {
    render(
      <Card onClick={() => {}}>
        <span>Continue</span>
      </Card>,
    );
    expect(
      screen.getByRole("button", { name: "Continue" }),
    ).toBeInTheDocument();
  });

  it("renders a card that does nothing as plain content", () => {
    render(
      <Card>
        <span>Nothing to do</span>
      </Card>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("the segmented control", () => {
  const options = [
    { value: "cloze", label: "Complete the phrase" },
    { value: "flashcard", label: "Flashcards" },
  ] as const;

  it("is a radio group, not a tab list without panels", () => {
    render(
      <SegmentedControl
        label="Practice format"
        options={options}
        value="cloze"
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("radiogroup", { name: "Practice format" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "Complete the phrase" }),
    ).toBeChecked();
  });

  it("moves between options with the arrow keys", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Practice format"
        options={options}
        value="cloze"
        onChange={onChange}
      />,
    );
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("flashcard");
  });

  it("keeps one tab stop, so the group is passed in a single Tab", () => {
    render(
      <SegmentedControl
        label="Practice format"
        options={options}
        value="cloze"
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByRole("radio", { name: "Complete the phrase" }),
    ).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Flashcards" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });
});

describe("navigation", () => {
  const tabs = [
    {
      key: "progress",
      label: "Progress",
      icon: "chart-no-axes-column",
      href: "/maintain/progress",
    },
    {
      key: "lexicon",
      label: "Lexicon",
      icon: "book-open",
      href: "/maintain/lexicon",
    },
  ] as const;

  it("names the bar and marks the current tab", () => {
    render(
      <TabBar
        tabs={tabs}
        activeKey="lexicon"
        label="Maintain"
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole("navigation", { name: "Maintain" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lexicon" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps tabs as links, so each carries a URL", () => {
    render(
      <TabBar
        tabs={tabs}
        activeKey="lexicon"
        label="Maintain"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("link", { name: "Progress" })).toHaveAttribute(
      "href",
      "/maintain/progress",
    );
  });

  it("gives each screen exactly one first-level heading", () => {
    const { rerender } = render(
      <TopBar title="Lexicon" large mode="Maintain" onMenu={() => {}} />,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    rerender(<TopBar title="Entry" onBack={() => {}} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
