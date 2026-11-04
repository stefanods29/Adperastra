import type { SearchResult } from "../services/search";

/** Bounded, paged result rows shared by every indexed view. The native page
 * never exceeds 256 rows / 768 KiB, so this list never grows unbounded. */

export interface ViewResultListProps {
  results: readonly SearchResult[];
  onOpenFile: (path: string) => void;
}

export default function ViewResultList({ results, onOpenFile }: ViewResultListProps) {
  if (results.length === 0) return null;
  return (
    <ul className="adp-view-results">
      {results.map((result) => (
        <li key={`${result.key.volume_id}:${result.key.file_id}:${result.key.path_key}`}>
          <button
            type="button"
            className="adp-view-result"
            onClick={() => onOpenFile(result.item.path)}
          >
            <span className="adp-view-result-name">{result.item.name}</span>
            <span className="adp-view-result-path">{result.item.path}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
