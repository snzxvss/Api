const express = require('express');
const axios = require('axios');
const { ytsearch, ytmp3, ytmp4 } = require('@dark-yasiya/yt-dl.js');
const unzipper = require('unzipper');


const app = express();
const port = process.env.PORT || 3000;

// Middleware para parsear JSON (opcional, si planeas manejar JSON en solicitudes)
app.use(express.json());

// Middleware para registrar las solicitudes y respuestas
app.use((req, res, next) => {
  // Registrar la solicitud entrante
  console.log(`\n[${new Date().toISOString()}] Recibida solicitud: ${req.method} ${req.originalUrl}`);
  console.log(`Parámetros de consulta: ${JSON.stringify(req.query)}`);

  // Escuchar el evento 'finish' para registrar la respuesta saliente
  res.on('finish', () => {
    console.log(`[${new Date().toISOString()}] Respuesta enviada con estado: ${res.statusCode}`);
    if (res.locals.responseBody) {
      console.log(`Contenido de la respuesta: ${JSON.stringify(res.locals.responseBody)}`);
    }
  });

  next();
});

// Función para realizar solicitudes con reintentos
async function fetchWithRetry(url, options, retries = 10, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, { ...options, responseType: 'arraybuffer' });
      console.log('response: ', response);
      console.log(`Intento ${i + 1}:`, response.status, response.statusText);
      
      if (response.headers['content-type'] === 'application/zip' || response.headers['content-disposition']?.includes('.zip')) {
        const buffer = Buffer.from(response.data);
        const directory = await unzipper.Open.buffer(buffer);
        const mp4File = directory.files.find(file => file.path.endsWith('.mp4'));
        
        if (mp4File) {
          const mp4Buffer = await mp4File.buffer();
          return { data: mp4Buffer };
        } else {
          throw new Error('No se encontró un archivo .mp4 en el .zip.');
        }
      }
      
      return response;
    } catch (error) {
      if (error.response && (error.response.status === 503 || error.response.status === 500)) {
        console.error(`Error ${error.response.status}. Reintentando en ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries reached');
}

// Función para realizar ytmp4 con reintentos
async function ytmp4WithRetry(videoUrl, quality, retries = 10, delay = 1000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await ytmp4(videoUrl, quality);
      console.log(`Intento ${attempt}:`, result);
      if (result && result.download && result.download.url) {
        return result;
      } else {
        console.error(`Intento ${attempt}: La respuesta de ytmp4 no contiene la URL de descarga.`);
        throw new Error('La respuesta de ytmp4 no contiene la URL de descarga.');
      }
    } catch (error) {
      if (attempt < retries) {
        console.error(`Intento ${attempt} fallido: ${error.message}. Reintentando en ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw new Error(`Error tras ${retries} intentos: ${error.message}`);
      }
    }
  }
}

// Ruta para buscar videos en YouTube
app.get('/search', async (req, res) => {
  const query = req.query.query;
  if (!query) {
    res.status(400).send('El parámetro "query" es requerido.');
    res.locals.responseBody = 'El parámetro "query" es requerido.';
    return;
  }

  try {
    const result = await ytsearch(query);
    res.locals.responseBody = result;
    res.json(result);
  } catch (error) {
    console.error('Error en la búsqueda:', error);
    const errorMessage = `Error en la búsqueda: ${error.message}`;
    res.status(500).send(errorMessage);
    res.locals.responseBody = errorMessage;
  }
});

// Ruta para descargar audio (MP3)
app.get('/download/audio', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    res.status(400).send('El parámetro "url" es requerido.');
    res.locals.responseBody = 'El parámetro "url" es requerido.';
    return;
  }

  try {
    const result = await ytmp3(videoUrl);
    res.locals.responseBody = result;

    const downloadUrl = result.download.url;
    const filename = result.download.filename || 'audio.mp3';

    // Realizar la solicitud de descarga utilizando axios con respuesta en streaming
    const response = await fetchWithRetry(downloadUrl, { responseType: 'stream' });

    // Establecer las cabeceras para la descarga
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'audio/mpeg');

    // Transmitir el contenido al cliente
    response.data.pipe(res);

    // Manejar errores en la transmisión
    response.data.on('error', (err) => {
      console.error('Error durante la transmisión del audio:', err);
      res.status(500).send('Error durante la transmisión del audio.');
    });

  } catch (error) {
    console.error('Error descargando audio:', error);
    const errorMessage = `Error descargando audio: ${error.message}`;
    res.status(500).send(errorMessage);
    res.locals.responseBody = errorMessage;
  }
});

// Ruta para descargar video (MP4) con calidad especificada
app.get('/download/video', async (req, res) => {
  const videoUrl = req.query.url;
  const quality = req.query.quality || '360p'; // Calidad por defecto: 360p

  if (!videoUrl) {
    res.status(400).send('El parámetro "url" es requerido.');
    res.locals.responseBody = 'El parámetro "url" es requerido.';
    return;
  }

  try {
    const result = await ytmp4WithRetry(videoUrl, quality);
    res.locals.responseBody = result;

    const downloadUrl = result.download.url;
    const filename = result.download.filename || 'video.mp4';

    // Realizar la solicitud de descarga utilizando fetchWithRetry
    const response = await fetchWithRetry(downloadUrl, { responseType: 'arraybuffer' });

    // Verificar si la respuesta es un Buffer (archivo .mp4 descomprimido)
    if (Buffer.isBuffer(response.data)) {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'video/mp4');
      res.send(response.data);
    } else {
      // Manejo habitual del stream
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'video/mp4');

      response.data.pipe(res);

      // Manejar errores en la transmisión
      response.data.on('error', (err) => {
        console.error('Error durante la transmisión del video:', err);
        res.status(500).send('Error durante la transmisión del video.');
      });
    }

  } catch (error) {
    console.error('Error descargando video:', error);
    const errorMessage = `Error descargando video: ${error.message}`;
    res.status(500).send(errorMessage);
    res.locals.responseBody = errorMessage;
  }
});

// Iniciar el servidor
app.listen(port, () => {
  console.log(`Servidor ejecutándose en http://localhost:${port}`);
});