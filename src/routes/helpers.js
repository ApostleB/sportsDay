function regenerate(req) {
  const keep = { events: req.session.events, admin: req.session.admin };
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      if (keep.events) req.session.events = keep.events;
      if (keep.admin) req.session.admin = true;
      resolve();
    });
  });
}

function setEventEntry(req, eventId, entry) {
  req.session.events = { ...(req.session.events || {}), [eventId]: entry };
}

function clearEventEntry(req, eventId) {
  const next = { ...(req.session.events || {}) };
  delete next[eventId];
  req.session.events = next;
}

function inviteUrl(req, event) {
  return `${req.protocol}://${req.get('host')}/e/${event.slug}?code=${encodeURIComponent(event.auth_code)}`;
}

module.exports = { regenerate, setEventEntry, clearEventEntry, inviteUrl };
