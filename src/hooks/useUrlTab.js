import { useEffect, useState } from 'react';

function readTabFromUrl(validIds, fallback) {
  const id = new URLSearchParams(window.location.search).get('tab');
  return validIds.includes(id) ? id : fallback;
}

// Keeps `activeTab` in sync with a `?tab=` URL param via pushState/popstate —
// deep-linkable and back/forward-friendly without pulling in a router for six
// flat tabs.
export function useUrlTab(tabs, fallback) {
  const validIds = tabs.map((t) => t.id);
  const [activeTab, setActiveTabState] = useState(() => readTabFromUrl(validIds, fallback));

  useEffect(() => {
    function onPopState() {
      setActiveTabState(readTabFromUrl(validIds, fallback));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setActiveTab(id) {
    if (id === activeTab) return;
    const url = new URL(window.location.href);
    url.searchParams.set('tab', id);
    window.history.pushState({ tab: id }, '', url);
    setActiveTabState(id);
  }

  return [activeTab, setActiveTab];
}
