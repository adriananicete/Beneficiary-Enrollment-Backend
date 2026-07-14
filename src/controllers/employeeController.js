import UserModel from '../models/userModel.js';
import { poolPromise } from '../config/db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import { SESSION_EXPIRY } from '../utils/constants.js';

export const login = async (req, res, next) => {
    try {
        const { username, password } = req.body;
        
        const pool = await poolPromise;

        const user = await UserModel.findUserByUsername(pool, username);
        if(!user) return res.status(401).json({error: 'Invalid credentials'});

        const isPasswordMatch = await bcrypt.compare(password, user.us01_password);
        if(!isPasswordMatch) return res.status(401).json({error: 'Invalid credentials'});

        if(!user.us01_last_login) return res.status(200).json({mustChangePassword: true});

        const token = jwt.sign({user_id: user.us01_user_id, username: user.us01_username, role_id: user.us02_role_id, role_name: user.us02_role_name }, config.jwtSecret, { expiresIn: '8h' });

        res.cookie('token', token, {
            httpOnly: true,
            secure: false,
            sameSite: "Strict",
            maxAge: SESSION_EXPIRY
        });

        return res.status(200).json({
            success: true,
            message: "Login successfully"
        });
    } catch (error) {
        next(error);
    }
};

export const logout = async (req, res, next) => {
    try {
        res.clearCookie('token', {
            httpOnly: true,
            secure: false,
            sameSite: 'Strict',
        });

        return res.status(200).json({
            success: true,
            message: 'Logout successful'
        });
    } catch (error) {
        next(error);
    }
};

export const getMyEnrollment = async (req, res, next) => {
    try {
        const { user_id, role_name } = req.user;

        
    } catch (error) {
        next(error);
    }
};

export const editMyEnrollment = async (req, res, next) => {
    try {
        const { user_id, role_name } = req.user;

        
    } catch (error) {
        next(error);
    }
};

