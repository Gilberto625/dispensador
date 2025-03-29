const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');

// Cargar variables de entorno
dotenv.config();

// Configuración del servidor Express
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Variables de entorno
const PORT = process.env.PORT || 3000;
const MQTT_BROKER = process.env.MQTT_BROKER;
const MQTT_PORT = process.env.MQTT_PORT;
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_CLIENT_ID = `mqtt_bridge_${Math.random().toString(16).slice(2, 8)}`;

// Tópicos MQTT
const TOPIC_COMIDA = 'dispensador/comida';
const TOPIC_AGUA = 'dispensador/agua';
const TOPIC_ESTADO = 'dispensador/estado';

// Conectar al broker MQTT
const mqttClient = mqtt.connect(`mqtt://${MQTT_BROKER}:${MQTT_PORT}`, {
  clientId: MQTT_CLIENT_ID,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  clean: true
});

// Estado del dispositivo
let estadoDispositivo = {
  nivelComida: 0,
  nivelAgua: 0,
  estadoComida: '',
  estadoAgua: ''
};

// Eventos MQTT
mqttClient.on('connect', () => {
  console.log('Conectado al broker MQTT');

  // Suscribirse a tópicos
  mqttClient.subscribe(TOPIC_ESTADO, (err) => {
    if (!err) {
      console.log(`Suscrito a ${TOPIC_ESTADO}`);
    }
  });
});

mqttClient.on('message', (topic, message) => {
  console.log(`Mensaje recibido en ${topic}: ${message.toString()}`);

  if (topic === TOPIC_ESTADO) {
    try {
      estadoDispositivo = JSON.parse(message.toString());
      // Emitir a todos los clientes conectados
      io.emit('estado', estadoDispositivo);
    } catch (error) {
      console.error('Error al parsear mensaje JSON:', error);
    }
  }
});

mqttClient.on('error', (error) => {
  console.error('Error de conexión MQTT:', error);
});

// Rutas API
app.get('/', (req, res) => {
  res.send('Servidor puente MQTT para dispensador de mascotas funcionando');
});

app.get('/api/estado', (req, res) => {
  res.json(estadoDispositivo);
});

app.post('/api/dispensar/comida', (req, res) => {
  mqttClient.publish(TOPIC_COMIDA, 'dispensar');
  res.json({ success: true, message: 'Comando de dispensar comida enviado' });
});

app.post('/api/dispensar/agua', (req, res) => {
  mqttClient.publish(TOPIC_AGUA, 'dispensar');
  res.json({ success: true, message: 'Comando de dispensar agua enviado' });
});

// Socket.io eventos
io.on('connection', (socket) => {
  console.log('Nuevo cliente conectado:', socket.id);

  // Enviar estado actual al cliente que se conecta
  socket.emit('estado', estadoDispositivo);

  // Escuchar eventos del cliente
  socket.on('dispensarComida', () => {
    mqttClient.publish(TOPIC_COMIDA, 'dispensar');
    console.log('Comando de dispensar comida enviado');
  });

  socket.on('dispensarAgua', () => {
    mqttClient.publish(TOPIC_AGUA, 'dispensar');
    console.log('Comando de dispensar agua enviado');
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// Iniciar servidor
server.listen(PORT, () => {
  console.log(`Servidor puente MQTT ejecutándose en el puerto ${PORT}`);
});
