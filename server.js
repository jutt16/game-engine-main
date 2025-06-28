require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');
const gameRoutes = require('./routes/gameRoutes');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Game Engine API',
      version: '1.0.0',
      description: 'API documentation for the multiplayer drawing game',
    },
    servers: [
      {
        url: process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000',
        description: 'API Server',
      }
    ],
    basePath: '/api',
  },
  apis: ['./routes/*.js'], // Path to the API routes
};

const swaggerDocs = swaggerJsDoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

// Middleware
app.use(cors());
// server.js
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// WebSocket connection handling
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Join game room
    socket.on('joinGame', (gameCode) => {
        socket.join(gameCode);
        console.log(`User ${socket.id} joined game ${gameCode}`);
    });

    // Leave game room
    socket.on('leaveGame', (gameCode) => {
        socket.leave(gameCode);
        console.log(`User ${socket.id} left game ${gameCode}`);
    });

    // Get game data via WebSocket
    socket.on('getGameData', async (gameCode) => {
        try {
            const Game = require('./models/Game');
            const game = await Game.findOne({ game_code: gameCode });
            
            if (game) {
                socket.emit('gameData', {
                    success: true,
                    game: game
                });
            } else {
                socket.emit('gameData', {
                    success: false,
                    message: 'Game not found'
                });
            }
        } catch (error) {
            socket.emit('gameData', {
                success: false,
                message: error.message
            });
        }
    });

    // Get incomplete users via WebSocket
    socket.on('getIncompleteUsers', async (data) => {
        try {
            const { gameCode, partName } = data;
            const Drawing = require('./models/Drawing');

            // Fetch unique player names for incomplete drawings for the game and part
            const incompletePlayers = await Drawing.distinct('player_name', { 
                game_code: gameCode, 
                player_part: partName, 
                is_completed: false 
            });

            if (!incompletePlayers || incompletePlayers.length === 0) {
                socket.emit('incompleteUsers', {
                    success: false,
                    message: 'No incomplete drawings found'
                });
                return;
            }

            socket.emit('incompleteUsers', {
                success: true,
                incompletePlayers: incompletePlayers
            });
        } catch (error) {
            socket.emit('incompleteUsers', {
                success: false,
                message: error.message
            });
        }
    });

    // Get drawing data via WebSocket
    socket.on('getDrawing', async (data) => {
        try {
            const { gameCode, playerName, partName } = data;
            const Drawing = require('./models/Drawing');

            // Fetch all drawing chunks for this player/part/game, ordered by chunk_index
            const drawings = await Drawing.find({
                game_code: gameCode,
                player_name: playerName,
                player_part: partName
            }).sort({ chunk_index: 1 });

            if (!drawings || drawings.length === 0) {
                socket.emit('drawingData', {
                    success: false,
                    message: 'Drawing not found'
                });
                return;
            }

            // Combine all drawing points from all chunks
            const allDrawingPoints = drawings.reduce((acc, doc) => {
                return acc.concat(doc.drawing_points);
            }, []);

            // Use the first chunk for meta fields
            const first = drawings[0];
            socket.emit('drawingData', {
                success: true,
                drawing: {
                    drawing_points: allDrawingPoints,
                    is_completed: first.is_completed,
                    player_name: first.player_name,
                    player_part: first.player_part,
                    game_code: first.game_code,
                    chunks: drawings.length,
                    total_points: allDrawingPoints.length
                }
            });
        } catch (error) {
            socket.emit('drawingData', {
                success: false,
                message: error.message
            });
        }
    });

    // Update game data and broadcast to all players in the room
    socket.on('updateGameData', async (data) => {
        try {
            const Game = require('./models/Game');
            const { gameCode, gameData } = data;
            
            // Update the game in database
            const updatedGame = await Game.findOneAndUpdate(
                { game_code: gameCode },
                gameData,
                { new: true }
            );

            if (updatedGame) {
                // Broadcast updated game data to all players in the room
                io.to(gameCode).emit('gameDataUpdated', {
                    success: true,
                    game: updatedGame
                });
            } else {
                socket.emit('gameDataUpdated', {
                    success: false,
                    message: 'Game not found'
                });
            }
        } catch (error) {
            socket.emit('gameDataUpdated', {
                success: false,
                message: error.message
            });
        }
    });

    // Update drawing status and broadcast to all players
    socket.on('updateDrawingStatus', async (drawingData) => {
        try {
            const Drawing = require('./models/Drawing');
            const MAX_POINTS = 50;
            let pointsToStore = drawingData.drawing_points;
            let chunk_index = 0;
            let createdChunks = [];

            // Find the latest chunk for this player/part/game
            const latestChunk = await Drawing.findOne({
                player_name: drawingData.player_name,
                player_part: drawingData.player_part,
                game_code: drawingData.game_code
            }).sort({ chunk_index: -1 });

            if (latestChunk && latestChunk.drawing_points.length < MAX_POINTS) {
                // Fill up the latest chunk if there's space
                const spaceLeft = MAX_POINTS - latestChunk.drawing_points.length;
                const pointsForThisChunk = pointsToStore.slice(0, spaceLeft);
                latestChunk.drawing_points.push(...pointsForThisChunk);
                await latestChunk.save();
                createdChunks.push(latestChunk);
                // Prepare remaining points for new chunks
                pointsToStore = pointsToStore.slice(spaceLeft);
                chunk_index = latestChunk.chunk_index + 1;
            } else if (latestChunk) {
                chunk_index = latestChunk.chunk_index + 1;
            }

            // Store remaining points in new chunks
            while (pointsToStore.length > 0) {
                const chunkPoints = pointsToStore.slice(0, MAX_POINTS);
                const newDrawing = new Drawing({
                    ...drawingData,
                    drawing_points: chunkPoints,
                    chunk_index
                });
                await newDrawing.save();
                createdChunks.push(newDrawing);
                pointsToStore = pointsToStore.slice(MAX_POINTS);
                chunk_index++;
            }

            // Broadcast drawing update to all players in the game room
            io.to(drawingData.game_code).emit('drawingUpdated', {
                success: true,
                player_name: drawingData.player_name,
                player_part: drawingData.player_part,
                is_completed: drawingData.is_completed,
                chunks: createdChunks.map(chunk => ({
                    id: chunk._id,
                    chunk_index: chunk.chunk_index,
                    pointsCount: chunk.drawing_points.length
                }))
            });

            socket.emit('drawingStatusUpdated', {
                success: true,
                message: 'Drawing status updated successfully (chunked)',
                chunks: createdChunks.map(chunk => ({
                    id: chunk._id,
                    chunk_index: chunk.chunk_index,
                    pointsCount: chunk.drawing_points.length
                }))
            });
        } catch (error) {
            socket.emit('drawingStatusUpdated', {
                success: false,
                message: error.message
            });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

// Routes
app.use('/api', gameRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong!', error: err.message });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    const HOST = '0.0.0.0';
    server.listen(PORT, HOST, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

// For Vercel
module.exports = app; 