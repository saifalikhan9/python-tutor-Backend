import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();

export const verifyToken = async (req, res, next) => {
  try {
    // Get token from cookies or Authorization header
    const token =
      req.cookies.token || req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res
        .status(401)
        .json({ message: "Access denied. No token provided." });
    }

    // Verify the JWT token
    const decoded = jwt.verify(token, process.env.SECRET_KEY);

    // Fetch user from database using the decoded username
    const user = await prisma.user.findUnique({
      where: { username: decoded.username },
    });

    if (!user) {
      return res.status(401).json({ message: "User not found." });
    }

    // Attach the user to the request object so it can be accessed in route handlers
    req.user = user;

    // Call next() to pass control to the next middleware or route handler
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ message: "Token expired. Please refresh your token." });
    }
    console.error("Error in verifyToken middleware:", error);
    res.status(400).json({ message: "Invalid token." });
  }
};
