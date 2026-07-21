const CEFR_LEVEL = /^(a1|a2|b1|b2|c1|c2)$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MODE_PREFIXES = [
  'error-correction',
  'listen-complete',
  'listening-quiz',
  'word-formation',
  'completion',
  'dictation',
  'flashcard',
  'matching',
  'reading',
  'reordering',
  'sorting',
  'transformation',
  'quiz',
].sort((left, right) => right.length - left.length);

export function isTechnicalTitle(title, contentId) {
  if (!title || title === contentId) return true;
  return SLUG_PATTERN.test(title) && title.includes('-');
}

export function humanizeContentId(contentId) {
  if (!contentId || typeof contentId !== 'string') return '—';

  let slug = contentId.trim();
  for (const prefix of MODE_PREFIXES) {
    if (slug.startsWith(`${prefix}-`)) {
      slug = slug.slice(prefix.length + 1);
      break;
    }
  }

  const parts = slug.split('-').filter(Boolean);
  let level = null;
  if (parts.length > 1 && CEFR_LEVEL.test(parts.at(-1))) {
    level = parts.pop().toUpperCase();
  }

  const name = parts
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  if (!name) return contentId;
  return level ? `${name} (${level})` : name;
}

export function resolveContentTitle(event, titleIndex) {
  const key = `${event.app}:${event.contentId}`;
  const indexed = titleIndex?.get(key);
  if (indexed) return indexed;
  if (event.title && !isTechnicalTitle(event.title, event.contentId)) return event.title;
  return humanizeContentId(event.contentId);
}

export function buildContentTitleIndex(appResults) {
  const index = new Map();

  appResults.forEach((result) => {
    const content = result.progress.data?.content;
    if (content) {
      Object.entries(content).forEach(([contentId, item]) => {
        if (item?.title && !isTechnicalTitle(item.title, contentId)) {
          index.set(`${result.app}:${contentId}`, item.title);
        }
      });
    }

    result.activity.data?.events?.forEach((event) => {
      if (event.title && !isTechnicalTitle(event.title, event.contentId)) {
        index.set(`${result.app}:${event.contentId}`, event.title);
      }
    });
  });

  return index;
}
