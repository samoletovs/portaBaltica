'use strict';

function normaliseSearch(value, address) {
  if (typeof value !== 'string' || value.length > 200) return null;
  const allowed = address
    ? /[^\w\sāčēģīķļņōŗšūžĀČĒĢĪĶĻŅŌŖŠŪŽ,.\-]/gi
    : /[^\w\sāčēģīķļņōŗšūžĀČĒĢĪĶĻŅŌŖŠŪŽ-]/gi;
  const query = value.replace(allowed, '').trim().replace(/\s+/g, ' ');
  return query.length >= 3 && /[a-z0-9āčēģīķļņōŗšūž]/i.test(query) ? query : null;
}

module.exports = { normaliseSearch: normaliseSearch };
