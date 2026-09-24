import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Chip,
  EntryRow,
  IconButton,
  TextField,
  TopBar,
} from "../../../design-system";
import type { StateKind } from "../../../design-system";
import { Screen } from "../../layout";
import { Empty, Failed, Loading } from "../ScreenState";
import { useAsync } from "../../shell/useAsync";
import { useClient } from "../../shell/ClientProvider";
import { useScreen } from "../../shell/useScreen";
import { useToast } from "../../shell/ToastProvider";
import { FrameLayer } from "../../shell/OverlayHost";
import type {
  Entry,
  EntryQuery,
  Language,
  Page,
  Starter,
} from "../../../api/types";

type Filter =
  "all" | "unverified" | "words" | "expressions" | "weak" | "strong" | string;

/** The worst state on an entry is the one the row shows. */
function rowState(entry: Entry): StateKind | undefined {
  const equivalents = entry.senses.flatMap((sense) => sense.equivalents);
  if (equivalents.some((equivalent) => equivalent.state === "failed"))
    return "failed";
  if (equivalents.some((equivalent) => equivalent.state === "waiting"))
    return "waiting";
  if (equivalents.some((equivalent) => equivalent.fit === "false-friend"))
    return "false-friend";
  if (equivalents.some((equivalent) => equivalent.state === "suggested"))
    return "unverified";
  return undefined;
}

function queryFor(filter: Filter, search: string): EntryQuery {
  const query: EntryQuery = {};
  if (search.trim()) query.search = search.trim();
  if (filter === "unverified") query.unverifiedOnly = true;
  else if (filter === "words") query.kind = "word";
  else if (filter === "expressions") query.kind = "expression";
  else if (filter === "weak" || filter === "strong") query.mastery = filter;
  else if (filter !== "all") query.language = filter;
  return query;
}

export function LexiconScreen() {
  const client = useClient();
  const navigate = useNavigate();
  const { openPanel } = useScreen();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const languages = useAsync(() => client.listLanguages(), [client]);
  const page = useAsync(
    () => client.listEntries(queryFor(filter, search)),
    [client, filter, search],
  );
  // Pages read after the first one, for a collection larger than a page.
  // They belong to the first page they followed, so a new search drops them.
  const [following, setFollowing] = useState<{
    after: Page<Entry> | null;
    pages: Page<Entry>[];
  }>({ after: null, pages: [] });
  const more = following.after === page.data ? following.pages : [];
  const [loadingMore, setLoadingMore] = useState(false);
  const { showToast } = useToast();

  const filters = useMemo(() => {
    const byLanguage = (languages.data ?? []).map((language: Language) => ({
      key: language.code,
      label: language.name,
      lang: language.code,
    }));
    return [
      { key: "all", label: "All", lang: undefined },
      ...byLanguage,
      { key: "unverified", label: "Unverified", lang: undefined },
      { key: "words", label: "Words", lang: undefined },
      { key: "expressions", label: "Expressions", lang: undefined },
      { key: "weak", label: "Needs practice", lang: undefined },
      { key: "strong", label: "Well known", lang: undefined },
    ];
  }, [languages.data]);

  const nameOf = (code: string) =>
    languages.data?.find((language) => language.code === code)?.name ??
    code.toUpperCase();

  const entries = [
    ...(page.data?.items ?? []),
    ...more.flatMap((next) => next.items),
  ];
  const nextCursor = (more.at(-1) ?? page.data)?.nextCursor;
  const total = page.data?.total;

  const loadMore = () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    const first = page.data;
    client
      .listEntries({ ...queryFor(filter, search), cursor: nextCursor })
      .then(
        (next) => {
          setFollowing((current) => ({
            after: first,
            pages: current.after === first ? [...current.pages, next] : [next],
          }));
          setLoadingMore(false);
        },
        () => {
          setLoadingMore(false);
          showToast("The rest of your Lexicon could not be read. Try again.");
        },
      );
  };

  return (
    <>
      <TopBar title="Lexicon" large mode="Maintain" onMenu={openPanel} />
      <Screen style={{ gap: 14 }}>
        <TextField
          icon="search"
          type="search"
          name="lexicon-search"
          ariaLabel="Search your Lexicon"
          placeholder="Search your Lexicon"
          value={search}
          onChange={setSearch}
        />

        <div
          role="group"
          aria-label="Filter your Lexicon"
          className="ow-scroll"
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            margin: "0 calc(-1 * var(--gutter))",
            padding: "0 var(--gutter) 2px",
          }}
        >
          {filters.map((option) => (
            <Chip
              key={option.key}
              selected={filter === option.key}
              lang={option.lang}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </Chip>
          ))}
        </div>

        {page.loading && !page.data ? (
          <Loading label="Reading your Lexicon." />
        ) : page.error ? (
          <Failed
            message="Your Lexicon could not be read. Nothing was lost."
            onRetry={page.reload}
          />
        ) : entries.length ? (
          <>
            <p
              style={{
                margin: 0,
                padding: "0 4px",
                font: "var(--type-caption)",
                color: "var(--fg-3)",
              }}
            >
              {total === undefined
                ? `${entries.length}${nextCursor ? "+" : ""} ${entries.length === 1 && !nextCursor ? "entry" : "entries"}`
                : entries.length === total
                  ? `${total} ${total === 1 ? "entry" : "entries"}`
                  : `${entries.length} of ${total} entries`}
            </p>
            <Card padding={0}>
              {entries.map((entry, index) => (
                <EntryRow
                  key={entry.id}
                  headword={entry.headword}
                  lang={entry.language}
                  note={entry.note}
                  state={rowState(entry)}
                  languages={Object.entries(entry.mastery).map(
                    ([code, mastery]) => ({
                      code,
                      name: nameOf(code),
                      recognise: mastery.recognise,
                      produce: mastery.produce,
                    }),
                  )}
                  onClick={() => navigate(`/maintain/lexicon/${entry.id}`)}
                  last={index === entries.length - 1}
                />
              ))}
            </Card>
            {nextCursor && (
              <Button
                variant="secondary"
                full
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? "Reading more." : "Show more"}
              </Button>
            )}
          </>
        ) : search.trim() ? (
          <Empty
            message={`Nothing in your Lexicon matches “${search.trim()}”.`}
          >
            <Button
              variant="secondary"
              icon="plus"
              onClick={() =>
                navigate("/maintain/add", {
                  state: { headword: search.trim() },
                })
              }
            >
              Add “{search.trim()}”
            </Button>
          </Empty>
        ) : filter !== "all" ? (
          <Empty message="Nothing in your Lexicon fits this filter yet.">
            <Button variant="secondary" onClick={() => setFilter("all")}>
              Show everything
            </Button>
          </Empty>
        ) : (
          <EmptyLexicon
            onAdded={page.reload}
            onAdd={() => navigate("/maintain/add")}
          />
        )}
      </Screen>

      <FrameLayer>
        <div
          style={{
            position: "absolute",
            right: 20,
            bottom: "calc(var(--tabbar-h) + var(--safe-bottom) + 16px)",
            zIndex: 4,
          }}
        >
          <IconButton
            name="plus"
            label="Add an entry"
            variant="filled"
            size={56}
            onClick={() => navigate("/maintain/add")}
            style={{ boxShadow: "var(--shadow-2)" }}
          />
        </div>
      </FrameLayer>
    </>
  );
}

/** One line of explanation, the starter expressions when there are any, and one action. */
function EmptyLexicon({
  onAdded,
  onAdd,
}: {
  onAdded: () => void;
  onAdd: () => void;
}) {
  const client = useClient();
  const starters = useAsync(() => client.listStarters(), [client]);
  const offered = starters.data ?? [];
  return (
    <Empty
      message={
        offered.length
          ? "Your Lexicon is empty. Tap a starter expression, or store the first thing you keep reaching for, and practice can start today."
          : "Your Lexicon is empty. Store the first thing you keep reaching for, with what it is in your other languages, and practice can start today."
      }
    >
      <div style={{ display: "grid", gap: 8 }}>
        <Starters starters={offered} onAdded={onAdded} />
        <Button
          variant={offered.length ? "ghost" : "secondary"}
          icon="plus"
          onClick={onAdd}
        >
          Add your first entry
        </Button>
      </div>
    </Empty>
  );
}

/** The one-tap starter expressions an empty Lexicon offers. */
function Starters({
  starters,
  onAdded,
}: {
  starters: readonly Starter[];
  onAdded: () => void;
}) {
  const client = useClient();
  const { showToast } = useToast();
  const [adding, setAdding] = useState(false);

  const add = (starter: Starter) => {
    setAdding(true);
    client.addStarter(starter.id).then(
      () => {
        showToast(`Added “${starter.headword}”. It is ready to practise.`, {
          icon: "check",
        });
        onAdded();
      },
      () => {
        setAdding(false);
        showToast("That starter could not be added. Nothing was lost.");
      },
    );
  };

  return (
    <>
      {starters.map((starter) => (
        <Button
          key={starter.id}
          variant="secondary"
          icon="plus"
          lang={starter.language}
          disabled={adding}
          onClick={() => add(starter)}
        >
          {starter.headword}
        </Button>
      ))}
    </>
  );
}
