const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Estado actual del dispensador (se actualiza con mensajes MQTT)
let dispensadorEstado = {
  nivelComida: null,
  nivelAgua: null,
  pesoComida: null,
  pesoAgua: null,
  bombaActiva: false,
  dispensandoComida: false,
  ultimaActualizacion: null,
  conectado: false
};

// Cola de confirmaciones recientes
const confirmaciones = [];
const MAX_CONFIRMACIONES = 10;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Conexión MQTT
const mqttOptions = {
  host: process.env.MQTT_HOST,
  port: parseInt(process.env.MQTT_PORT) || 8883,
  protocol: process.env.MQTT_PROTOCOL || 'mqtts',
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clientId: `render-bridge-${Math.random().toString(16).substring(2, 8)}`
};

console.log('Conectando a MQTT con opciones:', {
  host: mqttOptions.host,
  port: mqttOptions.port,
  protocol: mqttOptions.protocol,
  username: mqttOptions.username,
  clientId: mqttOptions.clientId
});

const mqttClient = mqtt.connect(mqttOptions);

mqttClient.on('connect', () => {
  console.log('Conectado al broker MQTT');
  
  // Suscribirse a los tópicos necesarios
  mqttClient.subscribe('dispensador/estado', (err) => {
    if (err) console.error('Error al suscribirse a estado:', err);
    else console.log('Suscrito a dispensador/estado');
  });
  
  mqttClient.subscribe('dispensador/confirmacion', (err) => {
    if (err) console.error('Error al suscribirse a confirmacion:', err);
    else console.log('Suscrito a dispensador/confirmacion');
  });
  
  mqttClient.subscribe('dispensador/conexion', (err) => {
    if (err) console.error('Error al suscribirse a conexion:', err);
    else console.log('Suscrito a dispensador/conexion');
  });
  
  // Publicar mensaje para solicitar estado actual
  mqttClient.publish('dispensador/comandos', 'status', { qos: 1 });
});

mqttClient.on('message', (topic, message) => {
  const messageStr = message.toString();
  console.log(`Mensaje recibido en ${topic}: ${messageStr}`);

  try {
    if (topic === 'dispensador/estado') {
      const estado = JSON.parse(messageStr);
      dispensadorEstado = {
        ...estado,
        ultimaActualizacion: new Date().toISOString(),
        conectado: true
      };
    } 
    else if (topic === 'dispensador/confirmacion') {
      // Agregar confirmación a la cola
      confirmaciones.unshift({
        mensaje: messageStr,
        timestamp: new Date().toISOString()
      });
      
      // Mantener solo las últimas MAX_CONFIRMACIONES
      if (confirmaciones.length > MAX_CONFIRMACIONES) {
        confirmaciones.pop();
      }
      
      // Actualizar estado según confirmación
      if (messageStr === 'comida:dispensando') {
        dispensadorEstado.dispensandoComida = true;
      } 
      else if (messageStr === 'comida:completado') {
        dispensadorEstado.dispensandoComida = false;
      }
      else if (messageStr === 'agua:activada') {
        dispensadorEstado.bombaActiva = true;
      }
      else if (messageStr === 'agua:desactivada') {
        dispensadorEstado.bombaActiva = false;
      }
    }
    else if (topic === 'dispensador/conexion') {
      dispensadorEstado.conectado = (messageStr === 'online');
    }
  } catch (error) {
    console.error('Error procesando mensaje MQTT:', error);
  }
});

mqttClient.on('error', (err) => {
  console.error('Error en conexión MQTT:', err);
});

// Rutas API

// Obtener estado actual
app.get('/api/estado', (req, res) => {
  // Verificar si el dispensador ha enviado datos recientemente (últimos 30 segundos)
  const ahora = new Date();
  const ultimaActualizacion = new Date(dispensadorEstado.ultimaActualizacion || 0);
  const segundosDesdeUltimaActualizacion = (ahora - ultimaActualizacion) / 1000;
  
  // Marcar como desconectado si no hay actualizaciones en los últimos 30 segundos
  if (segundosDesdeUltimaActualizacion > 30) {
    dispensadorEstado.conectado = false;
  }
  
  res.json(dispensadorEstado);
});

// Obtener confirmaciones recientes
app.get('/api/confirmaciones', (req, res) => {
  res.json(confirmaciones);
});

// Enviar comando al dispensador
app.post('/api/comando', (req, res) => {
  const { comando } = req.body;
  
  if (!comando) {
    return res.status(400).json({ error: 'Comando no especificado' });
  }
  
  // Validar comandos permitidos
  const comandosPermitidos = ['dispensar_comida', 'activar_agua', 'status'];
  if (!comandosPermitidos.includes(comando)) {
    return res.status(400).json({ error: 'Comando no válido' });
  }
  
  // Enviar comando vía MQTT
  mqttClient.publish('dispensador/comandos', comando, { qos: 1 }, (err) => {
    if (err) {
      console.error('Error al publicar comando:', err);
      return res.status(500).json({ error: 'Error al enviar comando' });
    }
    
    res.json({ 
      success: true, 
      mensaje: `Comando "${comando}" enviado correctamente` 
    });
  });
});

// Ruta de estado de la API
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'online',
    mqttConnected: mqttClient.connected,
    timestamp: new Date().toISOString()
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor API en ejecución en puerto ${PORT}`);
});