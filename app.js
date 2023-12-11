//running commands -to run this code follow this two steps
//1. npm install
// 2. node app.js


const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
const PORT = 3000;

// Create a PostgreSQL connection pool
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'E-Commerce',
  password: 'Samhitha',
  port: 5432,
});

// Create tables
const createTableQuery = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    userType VARCHAR(50) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS Catalogs (
    catalog_id SERIAL PRIMARY KEY,
    seller_id INT REFERENCES Users(id) UNIQUE,
    catalog_name VARCHAR(255) NOT NULL
);

-- Products table
CREATE TABLE IF NOT EXISTS Products (
    product_id SERIAL PRIMARY KEY,
    catalog_id INT REFERENCES Catalogs(catalog_id),
    product_name VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL
);

-- Orders table
CREATE TABLE IF NOT EXISTS Orders (
    order_id SERIAL PRIMARY KEY,
    buyer_id INT REFERENCES Users(id),
    seller_id INT REFERENCES Users(id),
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- OrderItems table (for many-to-many relationship between Orders and Products)
CREATE TABLE IF NOT EXISTS OrderItems (
    order_id INT REFERENCES Orders(order_id),
    product_id INT REFERENCES Products(product_id),
    quantity INT NOT NULL,
    PRIMARY KEY (order_id, product_id)
);
`;

pool.query(createTableQuery, (err, result) => {
  if (err) {
    console.error('Error creating users table:', err);
  }
});

app.use(express.json());


// Register endpoint


app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, userType } = req.body;


    const hashedPassword = await bcrypt.hash(password, 10);


    const insertUserQuery = 'INSERT INTO users (username, password, userType) VALUES ($1, $2, $3)';
    await pool.query(insertUserQuery, [username, hashedPassword, userType]);

    console.log('User registered successfully');
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


//login endpoint
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const user = result.rows[0];


    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }



    res.status(200).json({ message: 'Login successful' });
  } catch (error) {
    console.error('Error executing query', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/buyer/list-of-sellers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE userType = $1', ['seller']);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get the catalog of a seller by seller_id
app.get('/api/buyer/seller-catalog/:seller_id', async (req, res) => {
  const sellerId = req.params.seller_id;

  try {
    const result = await pool.query('SELECT * FROM catalogs WHERE seller_id = $1', [sellerId]);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Send a list of items to create an order for a seller with id = seller_id
app.post('/api/buyer/create-order/:seller_id', async (req, res) => {
  const sellerId = req.params.seller_id;
  const orderItems = req.body;
  const buyerId = req.body.buyer_id;

  try {
    // Check if the buyer exists and is of type 'buyer'
    const userTypeResult = await pool.query('SELECT usertype FROM users WHERE id = $1', [buyerId]);
    if (userTypeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Buyer not found' });
    }
    const userType = userTypeResult.rows[0].usertype;
    if (userType !== 'buyer') {
      return res.status(403).json({ error: 'Permission denied. User is not a buyer.' });
    }

    // Check if the seller exists
    const sellerResult = await pool.query('SELECT * FROM users WHERE id = $1 AND usertype = $2', [sellerId, 'seller']);
    if (sellerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    let orderId;

    if (Array.isArray(orderItems.orderItems)) {
      for (const orderItem of orderItems.orderItems) {
        // Check if the product belongs to the specified seller
        const productResult = await pool.query('SELECT * FROM products p JOIN catalogs c ON p.catalog_id = c.catalog_id WHERE p.product_id = $1 AND c.seller_id = $2', [orderItem.product_id, sellerId]);
        if (productResult.rows.length === 0) {
          return res.status(400).json({ error: 'Product does not belong to the specified seller' });
        }

        if (!orderId) {
          // Create the order only once
          const result = await pool.query('INSERT INTO orders (buyer_id, seller_id) VALUES ($1, $2) RETURNING order_id', [buyerId, sellerId]);
          orderId = result.rows[0].order_id;
        }

        // Insert order item
        await pool.query('INSERT INTO orderitems (order_id, product_id, quantity) VALUES ($1, $2, $3)', [orderId, orderItem.product_id, orderItem.quantity]);
      }

      res.json({ message: 'Order created successfully' });
    } else {
      console.error('Invalid orderItems format');
      res.status(400).json({ error: 'Invalid orderItems format' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Seller APIs

// Send a list of items to create a catalog for a seller

app.post('/api/seller/create-catalog', async (req, res) => {
  const { user_id, catalog_name, catalogItems } = req.body;

  try {
    
    const userTypeResult = await pool.query('SELECT userType FROM users WHERE id = $1', [user_id]);

    if (userTypeResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userType = userTypeResult.rows[0].usertype;


    if (userType !== 'seller') {
      return res.status(403).json({ error: 'Permission denied. User is not a seller.' });
    }

    const result = await pool.query('INSERT INTO catalogs (seller_id, catalog_name) VALUES ($1, $2) RETURNING catalog_id', [user_id, catalog_name]);

    const catalogId = result.rows[0].catalog_id;

    if (Array.isArray(catalogItems)) {
      for (const catalogItem of catalogItems) {
        await pool.query('INSERT INTO products (catalog_id, product_name, price) VALUES ($1, $2, $3)', [catalogId, catalogItem.product_name, catalogItem.price]);
      }

      res.json({ message: 'Catalog created successfully' });
    } else {
      res.status(400).json({ error: 'Invalid catalogItems format' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// Retrieve the list of orders received by a seller
app.get('/api/seller/orders', async (req, res) => {
  try {
    const sellerId = req.query.seller_id;

    if (!sellerId) {
      return res.status(400).json({ error: 'Missing seller_id parameter' });
    }

    const result = await pool.query('SELECT * FROM orders WHERE seller_id = $1', [parseInt(sellerId, 10)]);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
