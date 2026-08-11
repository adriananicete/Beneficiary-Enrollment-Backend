export const allowedRoles = (...roles) => {
  return (req, res, next) => {
    const role_name = req.user?.name;

    if(!role_name) return res.status(401).json({error: 'Unauthorized'})

    if (!roles.includes(role_name))
      return res.status(403).json({ error: "Access Denied!" });

    next();
  };
};
