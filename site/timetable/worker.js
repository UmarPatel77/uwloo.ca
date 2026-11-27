// Runs the timetable search off the page's main thread, so typing and scrolling stay smooth.
// The page sends {id, term, entries: {CS136: [title, rows]}, prefs}; this answers {id, result}.
const solver = import(`./solve.js${self.location.search}`);

self.onmessage = async ({ data }) => {
  const { id, term, entries, prefs } = data;
  try {
    const { run } = await import(`./run.js${self.location.search}`);
    self.postMessage({ id, result: run(await solver, term, entries, prefs) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
