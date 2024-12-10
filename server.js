import express from 'express';
import axios from 'axios';
import fs from 'fs';
import yts from 'yt-search';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import Tiktok from "@tobyg74/tiktok-api-dl";
import ytdl from 'ytdl-core'; // Reemplazado ytdlp por ytdl-core

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Definir __dirname manualmente
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 81;

// Endpoint para descargar videos de YouTube
app.get('/download', async (req, res) => {
  const { url, type } = req.query;

  if (!url || !type) {
    return res.status(400).send('Missing url or type parameter');
  }

  try {
    const requestId = uuidv4();
    const requestInfo = {
      requestId,
      url,
      type,
      origin: req.headers['origin'] || 'unknown',
      time: new Date().toISOString(),
      userAgent: req.headers['user-agent']
    };
    console.log('Request Info:', requestInfo);

    const mediaBuffer = await downloadMedia(url, type, requestId);

    res.set('Content-Type', type === 'audio' ? 'audio/mpeg' : 'video/mp4');
    res.send(mediaBuffer);
  } catch (error) {
    console.error('Error fetching media:', error);
    res.status(500).send('Error fetching media');
  }
});

// Endpoint para descargar videos de TikTok
app.get('/downloadtiktok', async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    console.log(`Received request for URL: ${url}`);
    const result = await Tiktok.Downloader(url, { version: "v1" });
    console.log('TikTok Downloader result:', result);
    if (result.status === "success") {
      const videoUrl = result.result.video.downloadAddr;
      console.log('Video URL:', videoUrl);
      const response = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Referer': 'https://www.tiktok.com/'
        }
      });
      console.log('Response status:', response.status);
      res.set('Content-Type', 'video/mp4');
      res.send(response.data);
    } else {
      console.error('TikTok Downloader error:', result.message);
      res.status(500).send('Error fetching media');
    }
  } catch (error) {
    console.error('Error fetching media:', error);
    res.status(500).send('Error fetching media');
  }
});

// Función de búsqueda
async function search(query, options = {}) {
  const search = await yts.search({ query, hl: 'es', gl: 'ES', ...options });
  return search.videos;
}

// Función para descargar media usando ytdl-core y fluent-ffmpeg
async function downloadMedia(url, type, requestId) {
  return new Promise((resolve, reject) => {
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    const outputFilePath = path.join(tempDir, `${requestId}_media.${type === 'audio' ? 'mp3' : 'mp4'}`);

    if (type === 'video') {
      const stream = ytdl(url, { quality: 'highestvideo' });

      ffmpeg(stream)
        .videoCodec('libx264')
        .audioCodec('aac')
        .format('mp4')
        .save(outputFilePath)
        .on('end', () => {
          fs.readFile(outputFilePath, (err, data) => {
            if (err) {
              console.error('Error reading file:', err);
              reject(err);
            } else {
              resolve(data);
              fs.unlink(outputFilePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
              });
            }
          });
        })
        .on('error', (err) => {
          console.error('FFmpeg Error:', err);
          reject(err);
        });
    } else if (type === 'audio') {
      const stream = ytdl(url, { quality: 'highestaudio' });

      ffmpeg(stream)
        .audioCodec('libmp3lame')
        .format('mp3')
        .save(outputFilePath)
        .on('end', () => {
          fs.readFile(outputFilePath, (err, data) => {
            if (err) {
              console.error('Error reading file:', err);
              reject(err);
            } else {
              resolve(data);
              fs.unlink(outputFilePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting temp file:', unlinkErr);
              });
            }
          });
        })
        .on('error', (err) => {
          console.error('FFmpeg Error:', err);
          reject(err);
        });
    } else {
      reject(new Error('Invalid type parameter'));
    }
  });
}