export const isAdmin = (req, res, next) => {
    const role = req.admin?.role;

    if(role !== 'admin' && role !== 'superadmin') return res.status(403).json({ error: 'Access Denied!' });
    
    next();
}