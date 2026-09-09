function notFound(req, _res, next) {
  const err = new Error(`Not Found - ${req.originalUrl}`);
  err.status = 404;
  next(err);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large.' });
  }
  console.error('ERR:', err.message);
  res.status(err.status || 500).json({
    error: err.expose ? err.message : 'Internal server error',
  });
}

module.exports = { notFound, errorHandler };