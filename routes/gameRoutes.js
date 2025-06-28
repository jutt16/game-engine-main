const express = require('express');
const router = express.Router();
const Game = require('../models/Game');
const Drawing = require('../models/Drawing');

/**
 * @swagger
 * components:
 *   schemas:
 *     GameState:
 *       type: object
 *       required:
 *         - game_code
 *         - games_Parts
 *         - players
 *       properties:
 *         created_at:
 *           type: string
 *         drawing_time:
 *           type: number
 *         game_code:
 *           type: string
 *         games_Parts:
 *           type: array
 *           items:
 *             type: string
 *         join:
 *           type: boolean
 *         number_of_players:
 *           type: number
 *         start_game:
 *           type: boolean
 *         players:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               game_code:
 *                 type: string
 *               player_body_images:
 *                 type: array
 *               player_body_parts_with_player_names:
 *                 type: array
 *               player_current_step:
 *                 type: array
 *               player_image:
 *                 type: string
 *               player_name:
 *                 type: string
 *               player_number:
 *                 type: number
 *     DrawingStatus:
 *       type: object
 *       required:
 *         - player_part
 *         - drawing_points
 *       properties:
 *         created_at:
 *           type: string
 *         drawed_parts_of_player:
 *           type: string
 *         drawing_points:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               offsetDx:
 *                 type: number
 *               offsetDy:
 *                 type: number
 *               pointType:
 *                 type: number
 *               pressure:
 *                 type: number
 *         is_completed:
 *           type: boolean
 *         player_drawing:
 *           type: string
 *         player_id:
 *           type: number
 *         player_image:
 *           type: string
 *         player_name:
 *           type: string
 *         player_part:
 *           type: string
 */

/**
 * @swagger
 * /api/storeGameState:
 *   post:
 *     summary: Store the game state
 *     tags: [Game]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GameState'
 *     responses:
 *       201:
 *         description: Game state stored successfully
 *       400:
 *         description: Invalid input
 */
router.post('/storeGameState', async (req, res) => {
    try {
        const gameData = req.body;
        const game = new Game(gameData);
        await game.save();
        res.status(201).json({ message: 'Game state stored successfully', game });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @swagger
 * /api/updateDrawingStatus:
 *   post:
 *     summary: Update drawing status
 *     tags: [Game]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DrawingStatus'
 *     responses:
 *       201:
 *         description: Drawing status updated successfully
 *       400:
 *         description: Invalid input
 */
router.post('/updateDrawingStatus', async (req, res) => {
    try {
        const drawingData = req.body;
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

        res.status(201).json({ 
            message: 'Drawing status updated successfully (chunked)',
            chunks: createdChunks.map(chunk => ({
                id: chunk._id,
                chunk_index: chunk.chunk_index,
                pointsCount: chunk.drawing_points.length
            }))
        });
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

/**
 * @swagger
 * /api/incompleteUsers/{game_code}/{part_name}:
 *   get:
 *     summary: Get incomplete users for a game and part
 *     tags: [Game]
 *     parameters:
 *       - in: path
 *         name: game_code
 *         schema:
 *           type: string
 *         required: true
 *         description: Game code
 *       - in: path
 *         name: part_name
 *         schema:
 *           type: string
 *         required: true
 *         description: Part name
 *     responses:
 *       200:
 *         description: List of incomplete players
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 incompletePlayers:
 *                   type: array
 *                   items:
 *                     type: string
 *       404:
 *         description: Game or part not found
 */
router.get('/incompleteUsers/:game_code/:part_name', async (req, res) => {
    try {
        const { game_code, part_name } = req.params;

        // Fetch unique player names for incomplete drawings for the game and part
        const incompletePlayers = await Drawing.distinct('player_name', { 
            game_code, 
            player_part: part_name, 
            is_completed: false 
        });

        if (!incompletePlayers || incompletePlayers.length === 0) {
            return res.status(404).json({ message: 'No incomplete drawings found' });
        }

        res.json({ incompletePlayers });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @swagger
 * /api/getDrawing/{game_code}/{player_name}/{part_name}:
 *   get:
 *     summary: Get drawing data for a player and part
 *     tags: [Game]
 *     parameters:
 *       - in: path
 *         name: game_code
 *         schema:
 *           type: string
 *         required: true
 *         description: Game code
 *       - in: path
 *         name: player_name
 *         schema:
 *           type: string
 *         required: true
 *         description: Player name
 *       - in: path
 *         name: part_name
 *         schema:
 *           type: string
 *         required: true
 *         description: Part name
 *     responses:
 *       200:
 *         description: Drawing data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 drawing_points:
 *                   type: array
 *                   items:
 *                     type: object
 *                 is_completed:
 *                   type: boolean
 *       404:
 *         description: Drawing not found
 */
router.get('/getDrawing/:game_code/:player_name/:part_name', async (req, res) => {
    try {
        const { game_code, player_name, part_name } = req.params;
        // Fetch all drawing chunks for this player/part/game, ordered by chunk_index
        const drawings = await Drawing.find({
            game_code,
            player_name,
            player_part: part_name
        }).sort({ chunk_index: 1 });

        if (!drawings || drawings.length === 0) {
            return res.status(404).json({ message: 'Drawing not found' });
        }

        // Combine all drawing points from all chunks
        const allDrawingPoints = drawings.reduce((acc, doc) => {
            return acc.concat(doc.drawing_points);
        }, []);

        // Use the first chunk for meta fields
        const first = drawings[0];
        res.json({
            drawing_points: allDrawingPoints,
            is_completed: first.is_completed,
            player_name: first.player_name,
            player_part: first.player_part,
            game_code: first.game_code,
            chunks: drawings.length,
            total_points: allDrawingPoints.length
        });
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
});

/**
 * @swagger
 * /api/completedDrawings/{game_code}:
 *   get:
 *     summary: Get all completed drawings for a game
 *     tags: [Game]
 *     parameters:
 *       - in: path
 *         name: game_code
 *         schema:
 *           type: string
 *         required: true
 *         description: Game code
 *     responses:
 *       200:
 *         description: List of completed drawings
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/DrawingStatus'
 *       404:
 *         description: No completed drawings found
 */
router.get('/completedDrawings/:game_code', async (req, res) => {
    try {
        const { game_code } = req.params;
        
        // Delete all incomplete drawings for this game_code
        await Drawing.deleteMany({
            game_code,
            is_completed: false
        });
        
        // Find all completed drawings for the game without sorting
        const completedDrawings = await Drawing.find({
            game_code,
            is_completed: true
        }).lean(); // Use lean() for better performance

        if (!completedDrawings || completedDrawings.length === 0) {
            return res.status(404).json({ message: 'No completed drawings found' });
        }

        // Group drawings by player_name and player_part to combine chunks
        const groupedDrawings = new Map();
        
        completedDrawings.forEach(drawing => {
            const key = `${drawing.player_name}-${drawing.player_part}`;
            
            if (!groupedDrawings.has(key)) {
                groupedDrawings.set(key, {
                    created_at: drawing.created_at,
                    drawed_parts_of_player: drawing.drawed_parts_of_player,
                    drawing_points: [],
                    is_completed: drawing.is_completed,
                    player_drawing: drawing.player_drawing,
                    player_id: drawing.player_id,
                    player_image: drawing.player_image,
                    player_name: drawing.player_name,
                    player_part: drawing.player_part,
                    game_code: drawing.game_code
                });
            }
            
            // Add drawing points from this chunk
            const group = groupedDrawings.get(key);
            group.drawing_points.push(...drawing.drawing_points);
        });

        // Convert grouped drawings back to array
        const uniqueCompletedDrawings = Array.from(groupedDrawings.values());

        res.json(uniqueCompletedDrawings);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @swagger
 * /api/updateGameWithPlayer:
 *   put:
 *     summary: Update game with new player data
 *     tags: [Game]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - game_code
 *               - player_data
 *             properties:
 *               game_code:
 *                 type: string
 *               player_data:
 *                 type: object
 *                 properties:
 *                   player_name:
 *                     type: string
 *                   player_number:
 *                     type: number
 *                   player_image:
 *                     type: string
 *                   player_body_parts_with_player_names:
 *                     type: array
 *                     items:
 *                       type: string
 *                   player_current_step:
 *                     type: array
 *                     items:
 *                       type: number
 *     responses:
 *       200:
 *         description: Game updated successfully
 *       404:
 *         description: Game not found
 */
router.put('/updateGameWithPlayer', async (req, res) => {
    try {
        const { game_code, player_data } = req.body;

        // Find the game by game_code
        const game = await Game.findOne({ game_code });
        if (!game) {
            return res.status(404).json({ message: 'Game not found' });
        }

        // Add game_code to player data
        const updatedPlayerData = {
            ...player_data,
            game_code: game_code,
            player_body_images: player_data.player_body_images || []
        };

        // Add new player to players array
        game.players.push(updatedPlayerData);

        // Update number_of_players based on players array length
        game.number_of_players = game.players.length;

        // Save the updated game
        await game.save();

        res.status(200).json({
            message: 'Game updated successfully',
            game: game
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @swagger
 * /api/updateGameStatus:
 *   put:
 *     summary: Update game status fields (admin only)
 *     tags: [Game]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - game_code
 *             properties:
 *               game_code:
 *                 type: string
 *               start_game:
 *                 type: boolean
 *               join:
 *                 type: boolean
 *               drawing_time:
 *                 type: number
 *     responses:
 *       200:
 *         description: Game status updated successfully
 *       404:
 *         description: Game not found
 */
router.put('/updateGameStatus', async (req, res) => {
    try {
        const { game_code, start_game, join, drawing_time } = req.body;

        // Find the game by game_code
        const game = await Game.findOne({ game_code });
        if (!game) {
            return res.status(404).json({ message: 'Game not found' });
        }

        // Update only the fields that are provided
        if (start_game !== undefined) {
            game.start_game = start_game;
        }
        if (join !== undefined) {
            game.join = join;
        }
        if (drawing_time !== undefined) {
            game.drawing_time = drawing_time;
        }

        // Save the updated game
        await game.save();

        res.status(200).json({
            message: 'Game status updated successfully',
            game: game
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @swagger
 * /api/validateJoinGame:
 *   post:
 *     summary: Validate if user can join the game and add them if possible
 *     tags: [Game]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - game_code
 *               - player_data
 *             properties:
 *               game_code:
 *                 type: string
 *               player_data:
 *                 type: object
 *                 properties:
 *                   player_name:
 *                     type: string
 *                   player_number:
 *                     type: number
 *                   player_image:
 *                     type: string
 *                   player_body_parts_with_player_names:
 *                     type: array
 *                     items:
 *                       type: string
 *                   player_current_step:
 *                     type: array
 *                     items:
 *                       type: number
 *     responses:
 *       200:
 *         description: User joined the game successfully
 *       400:
 *         description: Game has already started or room is closed
 *       404:
 *         description: Game not found
 */
router.post('/validateJoinGame', async (req, res) => {
    try {
        const { game_code, player_data } = req.body;

        // Find the game by game_code
        const game = await Game.findOne({ game_code });
        if (!game) {
            return res.status(404).json({ message: 'Game not found' });
        }

        // Check if game has already started
        if (game.start_game) {
            return res.status(400).json({ 
                message: 'Room already started',
                canJoin: false
            });
        }

        // Check if game is open for joining
        if (!game.join) {
            return res.status(400).json({ 
                message: 'Room is not accepting new players',
                canJoin: false
            });
        }

        // Add game_code to player data
        const updatedPlayerData = {
            ...player_data,
            game_code: game_code,
            player_body_images: player_data.player_body_images || []
        };

        // Add new player to players array
        game.players.push(updatedPlayerData);

        // Update number_of_players based on players array length
        game.number_of_players = game.players.length;

        // Save the updated game
        await game.save();

        res.status(200).json({
            message: 'User joined the game successfully',
            canJoin: true,
            game: {
                game_code: game.game_code,
                number_of_players: game.number_of_players,
                games_Parts: game.games_Parts,
                players: game.players
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

/**
 * @swagger
 * /api/getGameData/{game_code}:
 *   get:
 *     summary: Get game data by game code
 *     tags: [Game]
 *     parameters:
 *       - in: path
 *         name: game_code
 *         schema:
 *           type: string
 *         required: true
 *         description: Game code
 *     responses:
 *       200:
 *         description: Game data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GameState'
 *       404:
 *         description: Game not found
 */
router.get('/getGameData/:game_code', async (req, res) => {
    try {
        const { game_code } = req.params;

        // Find the game by game_code
        const game = await Game.findOne({ game_code });
        if (!game) {
            return res.status(404).json({ message: 'Game not found' });
        }

        res.status(200).json({
            message: 'Game data retrieved successfully',
            game: game
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router; 