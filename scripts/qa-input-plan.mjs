// Build real down/up actions; holds never call Session.resolve or forge time.
export function inputPlan(chart, keys) {
  return chart.flatMap((note, id) => [
    { time: note.time, code: keys[note.lane], lane: note.lane, type: 'keydown', id },
    { time: (note.endTime ?? note.time) + .005, code: keys[note.lane], lane: note.lane, type: 'keyup', id },
  ]).sort((a, b) => a.time - b.time || a.id - b.id);
}

export function playChart(session, chart, keys = ['S', 'D', 'F', 'J', 'K', 'L']) {
  for (const action of inputPlan(chart, keys)) {
    session.expire(action.time);
    if (action.type === 'keydown') session.hit(action.lane, action.time);
    else session.release(action.lane, action.time);
  }
  return session;
}
