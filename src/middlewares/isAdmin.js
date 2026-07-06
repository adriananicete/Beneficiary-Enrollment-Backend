export const isAdmin = (req, res, next) => {
    if(!req.admin) return res.status(403).json({error: 'Access Denied!'});
    next();
}