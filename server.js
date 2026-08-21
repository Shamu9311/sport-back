import app from './app.js';

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});

process.on('unhandledRejection', (err) => {
  console.error('⚠️ Error no manejado:', err);
});
