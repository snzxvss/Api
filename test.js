import { spawn } from 'child_process';

const videoURL = 'https://www.youtube.com/watch?v=DHjqpvDnNGE';
const outputPath = 'out.mkv';

// Inicia el proceso de ffmpeg sin la barra de progreso
const ffmpeg = spawn('ffmpeg', [
  '-loglevel', '8', '-hide_banner',
  '-i', 'pipe:3', // Entrada de audio
  '-i', 'pipe:4', // Entrada de video
  '-map', '0:a',
  '-map', '1:v',
  '-c:v', 'copy',
  outputPath,
], {
  stdio: [
    'inherit', // stdin
    'inherit', // stdout
    'inherit', // stderr
    'pipe',    // pipe:3 (audio)
    'pipe',    // pipe:4 (video)
  ],
});

// Maneja el cierre del proceso ffmpeg
ffmpeg.on('close', (code) => {
  if (code === 0) {
    console.log('Proceso de ffmpeg completado exitosamente.');
  } else {
    console.error(`ffmpeg salió con el código ${code}`);
  }
});

// Función para manejar errores de spawn
const handleSpawnError = (processName, err) => {
  console.error(`Error al iniciar el proceso ${processName}:`, err.message);
  process.exit(1); // Salir del script con error
};

// Maneja errores de ffmpeg
ffmpeg.on('error', (err) => {
  handleSpawnError('ffmpeg', err);
});

// Descarga audio con yt-dlp
const audio = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', videoURL], { stdio: ['ignore', 'pipe', 'inherit'] });
audio.on('error', (err) => {
  handleSpawnError('yt-dlp (audio)', err);
});
audio.stdout.pipe(ffmpeg.stdio[3]);

audio.on('close', (code) => {
  if (code !== 0) {
    console.error(`yt-dlp para audio salió con código ${code}`);
  }
});

// Descarga video con yt-dlp
const video = spawn('yt-dlp', ['-f', 'bestvideo', '-o', '-', videoURL], { stdio: ['ignore', 'pipe', 'inherit'] });
video.on('error', (err) => {
  handleSpawnError('yt-dlp (video)', err);
});
video.stdout.pipe(ffmpeg.stdio[4]);

video.on('close', (code) => {
  if (code !== 0) {
    console.error(`yt-dlp para video salió con código ${code}`);
  }
});