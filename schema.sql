
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    total_analyses INTEGER DEFAULT 0,
                    stego_detections INTEGER DEFAULT 0,
                    pdf_reports INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS analyses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    filename TEXT NOT NULL,
                    model_score REAL NOT NULL,
                    final_prediction TEXT NOT NULL,
                    message_found BOOLEAN NOT NULL,
                    extracted_message TEXT,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                );
                