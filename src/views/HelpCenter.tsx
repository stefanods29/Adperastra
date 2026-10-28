import DOMPurify from "dompurify";
import { FileText } from "lucide-react";
import MarkdownIt from "markdown-it";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import HelpButton from "../components/HelpButton";
import ListRow from "../components/ListRow";
import SearchBox from "../components/SearchBox";
import Skeleton from "../components/Skeleton";
import { getHelpPage, listHelp, searchHelp, type HelpPageSummary } from "../services/help";

export interface HelpCenterProps {
  lang: string;
  requestedSlug?: string;
  onOpenHelp: (slug: string) => void;
}

export default function HelpCenter({ lang, requestedSlug, onOpenHelp }: HelpCenterProps) {
  const { t } = useTranslation();
  const [pages, setPages] = useState([] as HelpPageSummary[]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("getting-started" as string);
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const md = useMemo(() => new MarkdownIt({ html: false }), []);

  useEffect(() => {
    if (requestedSlug) setSelected(requestedSlug);
  }, [requestedSlug]);

  useEffect(() => {
    let cancelled = false;
    const load = query.trim() ? searchHelp(query, lang) : listHelp(lang);
    load
      .then((result) => {
        if (!cancelled) setPages(result);
      })
      .catch(() => {
        if (!cancelled) setPages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [lang, query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    getHelpPage(selected, lang)
      .then((page) => {
        if (!cancelled) setMarkdown(page);
      })
      .catch(() => {
        if (!cancelled) {
          setMarkdown("");
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lang, selected]);

  const html = useMemo(() => {
    return DOMPurify.sanitize(md.render(markdown));
  }, [md, markdown]);

  return (
    <div className="adp-help">
      <aside className="adp-help-sidebar">
        <div className="adp-view-header">
          <h2 className="adp-heading">{t("help.title")}</h2>
          <HelpButton onOpenHelp={() => onOpenHelp("using-help")} />
        </div>
        <SearchBox value={query} onChange={setQuery} placeholder={t("help.searchPlaceholder")} />
        <div>
          {pages.map((page) => (
            <ListRow
              key={page.slug}
              icon={FileText}
              name={page.title ?? page.slug}
              selected={selected === page.slug}
              onClick={() => setSelected(page.slug)}
            />
          ))}
          {pages.length === 0 ? <p className="adp-note">{t("help.noResults")}</p> : null}
        </div>
      </aside>
      <section className="adp-help-main">
        {loading ? <Skeleton variant="rows" count={5} /> : null}
        {!loading && failed ? <p className="adp-note">{t("help.loadError")}</p> : null}
        {!loading && !failed && markdown ? (
          <div className="adp-help-body" dangerouslySetInnerHTML={{ __html: html }} />
        ) : null}
        {!loading && !failed && !markdown ? <p className="adp-note">{t("help.selectPage")}</p> : null}
      </section>
    </div>
  );
}
