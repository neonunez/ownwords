import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Chip, EntryRow, IconButton, TextField, TopBar } from '../../../design-system';
import type { StateKind } from '../../../design-system';
import { Screen } from '../../layout';
import { Empty, Failed, Loading } from '../ScreenState';
import { useAsync } from '../../shell/useAsync';
import { useClient } from '../../shell/ClientProvider';
import { useScreen } from '../../shell/useScreen';
import { FrameLayer } from '../../shell/OverlayHost';
import type { Entry, EntryQuery, Language } from '../../../api/types';

type Filter = 'all' | 'unverified' | 'expressions' | string;

/** The worst state on an entry is the one the row shows. */
function rowState(entry: Entry): StateKind | undefined {
  const equivalents = entry.senses.flatMap((sense) => sense.equivalents);
  if (equivalents.some((equivalent) => equivalent.state === 'failed')) return 'failed';
  if (equivalents.some((equivalent) => equivalent.state === 'waiting')) return 'waiting';
  if (equivalents.some((equivalent) => equivalent.fit === 'false-friend')) return 'false-friend';
  if (equivalents.some((equivalent) => equivalent.state === 'suggested')) return 'unverified';
  return undefined;
}

function queryFor(filter: Filter, search: string): EntryQuery {
  const query: EntryQuery = {};
  if (search.trim()) query.search = search.trim();
  if (filter === 'unverified') query.unverifiedOnly = true;
  else if (filter === 'expressions') query.kind = 'expression';
  else if (filter !== 'all') query.language = filter;
  return query;
}

export function LexiconScreen() {
  const client = useClient();
  const navigate = useNavigate();
  const { openPanel } = useScreen();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const languages = useAsync(() => client.listLanguages(), [client]);
  const page = useAsync(() => client.listEntries(queryFor(filter, search)), [client, filter, search]);

  const filters = useMemo(() => {
    const byLanguage = (languages.data ?? []).map((language: Language) => ({
      key: language.code,
      label: language.name,
      lang: language.code,
    }));
    return [
      { key: 'all', label: 'All', lang: undefined },
      ...byLanguage,
      { key: 'unverified', label: 'Unverified', lang: undefined },
      { key: 'expressions', label: 'Expressions', lang: undefined },
    ];
  }, [languages.data]);

  const nameOf = (code: string) =>
    languages.data?.find((language) => language.code === code)?.name ?? code.toUpperCase();

  const entries = page.data?.items ?? [];
  const total = page.data?.total ?? entries.length;

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
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            margin: '0 calc(-1 * var(--gutter))',
            padding: '0 var(--gutter) 2px',
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
          <Failed message="Your Lexicon could not be read. Nothing was lost." onRetry={page.reload} />
        ) : entries.length ? (
          <>
            <p
              style={{
                margin: 0,
                padding: '0 4px',
                font: 'var(--type-caption)',
                color: 'var(--fg-3)',
              }}
            >
              {entries.length === total
                ? `${total} ${total === 1 ? 'entry' : 'entries'}`
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
                  languages={Object.entries(entry.mastery).map(([code, mastery]) => ({
                    code,
                    name: nameOf(code),
                    recognise: mastery.recognise,
                    produce: mastery.produce,
                  }))}
                  onClick={() => navigate(`/maintain/lexicon/${entry.id}`)}
                  last={index === entries.length - 1}
                />
              ))}
            </Card>
          </>
        ) : search.trim() ? (
          <Empty message={`Nothing in your Lexicon matches “${search.trim()}”.`}>
            <Button
              variant="secondary"
              icon="plus"
              onClick={() => navigate('/maintain/add', { state: { headword: search.trim() } })}
            >
              Add “{search.trim()}”
            </Button>
          </Empty>
        ) : (
          <Empty message="Your Lexicon is empty. Store the first thing you keep reaching for, and practice can start today.">
            <Button variant="secondary" icon="plus" onClick={() => navigate('/maintain/add')}>
              Add your first entry
            </Button>
          </Empty>
        )}
      </Screen>

      <FrameLayer>
        <div
          style={{
            position: 'absolute',
            right: 20,
            bottom: 'calc(var(--tabbar-h) + var(--safe-bottom) + 16px)',
            zIndex: 4,
          }}
        >
          <IconButton
            name="plus"
            label="Add an entry"
            variant="filled"
            size={56}
            onClick={() => navigate('/maintain/add')}
            style={{ boxShadow: 'var(--shadow-2)' }}
          />
        </div>
      </FrameLayer>
    </>
  );
}
