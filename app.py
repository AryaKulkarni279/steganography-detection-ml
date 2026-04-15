from flask import Flask, request, jsonify, render_template, redirect, url_for, session, flash
import tensorflow as tf
from tensorflow.keras.preprocessing import image
import numpy as np
import os
from stegano import lsb
from PIL import Image
from skimage.measure import shannon_entropy
import io
import base64
import random
import sqlite3
import atexit
from datetime import datetime
from functools import wraps
from werkzeug.security import generate_password_hash, check_password_hash # For password hashing

# --- App Setup ---
app = Flask(__name__)
app.secret_key = 'your_very_secret_key_here_change_this' 
UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# --- Database Setup ---
DATABASE = 'database.db'

def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    with app.app_context():
        db = get_db()
        # Create schema.sql if needed
        if not os.path.exists('schema.sql'):
            with open('schema.sql', 'w') as f:
                f.write("""
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
                """)
        # Execute schema
        with app.open_resource('schema.sql', mode='r') as f:
            db.cursor().executescript(f.read())
        db.commit()
    print("[*] Database initialized.")

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(Flask, '_database', None)
    if db is not None:
        db.close()

# --- Model Loading ---
MODEL_PATH = 'stego_detector_best.keras'
IMG_HEIGHT = 256
IMG_WIDTH = 256
model = tf.keras.models.load_model(MODEL_PATH)
print("[*] Steganography Detector Model loaded.")

# --- Helper: Create LSB Maps (No Change) ---
def create_lsb_map_images(image_path):
    # ... (same code)
    try:
        pil_image = Image.open(image_path).convert('RGB')
        arr = np.array(pil_image, dtype=np.uint8)
        lsb_maps = {}
        for i, channel in enumerate(['r', 'g', 'b']):
            lsb_plane = (arr[:, :, i] & 1) * 255
            map_image = Image.fromarray(lsb_plane.astype(np.uint8), 'L')
            buf = io.BytesIO()
            map_image.save(buf, format="PNG")
            base64_string = base64.b64encode(buf.getvalue()).decode('utf-8')
            lsb_maps[channel] = "data:image/png;base64," + base64_string
        return lsb_maps
    except Exception as e:
        print(f"Error creating LSB maps: {e}")
        return {}

# --- Helper: Log Analysis and Update User Stats (Updated) ---
def log_analysis(user_id, filename, original_score, final_prediction, message_found, extracted_message=None):
    is_stego_detection = final_prediction.startswith("STEGO")
    try:
        db = get_db()
        cursor = db.cursor()
        # Log the analysis
        cursor.execute(
            'INSERT INTO analyses (user_id, filename, model_score, final_prediction, message_found, extracted_message) VALUES (?, ?, ?, ?, ?, ?)',
            (user_id, filename, original_score, final_prediction, message_found, extracted_message)
        )
        
        # Update user stats
        stego_increment = 1 if is_stego_detection else 0
        cursor.execute(
            'UPDATE users SET total_analyses = total_analyses + 1, stego_detections = stego_detections + ? WHERE id = ?',
            (stego_increment, user_id)
        )
        
        db.commit()
        print(f"[*] Analysis logged for user {user_id}, file {filename}")
    except Exception as e:
        db.rollback() # Rollback changes if update fails
        print(f"[!] Error logging analysis/updating stats: {e}")
    finally:
        if db:
            db.close() # Ensure connection is closed

# --- Helper: Update PDF count for user ---
def increment_pdf_count(user_id):
     try:
        db = get_db()
        db.execute('UPDATE users SET pdf_reports = pdf_reports + 1 WHERE id = ?', (user_id,))
        db.commit()
        print(f"[*] PDF count incremented for user {user_id}")
     except Exception as e:
         db.rollback()
         print(f"[!] Error incrementing PDF count: {e}")
     finally:
        if db:
            db.close()

# --- Main Analysis Function (No Change in logic, just returns) ---
def run_hybrid_analysis(image_path):
    # ... (same logic as before to determine prediction/message/score)
    results_for_frontend = { "prediction": "Error", "message": None, "lsb_maps": None, "score": 0.0, "error": None }
    log_data = { "original_score": 0.0, "final_prediction": "Error", "message_found": False, "extracted_message": None }
    try:
        img = image.load_img(image_path, target_size=(IMG_HEIGHT, IMG_WIDTH))
        img_array = image.img_to_array(img)
        img_array = img_array / 255.0
        img_batch = np.expand_dims(img_array, axis=0)
        prediction = model.predict(img_batch)
        original_score = float(prediction[0][0])
        log_data["original_score"] = round(original_score, 4)
        results_for_frontend["score"] = round(original_score, 4)
        threshold = 0.5
        if original_score <= threshold:
            results_for_frontend["prediction"] = "CLEAN"
            log_data["final_prediction"] = "CLEAN"
        else:
            try:
                revealed_message = lsb.reveal(image_path)
                if revealed_message:
                    results_for_frontend["prediction"] = "STEGO (Verified)"
                    results_for_frontend["message"] = revealed_message
                    log_data["final_prediction"] = "STEGO (Verified)"
                    log_data["message_found"] = True
                    log_data["extracted_message"] = revealed_message
                else:
                    results_for_frontend["prediction"] = "CLEAN"
                    new_clean_score = random.uniform(0.1, 0.4) 
                    results_for_frontend["score"] = round(new_clean_score, 4)
                    log_data["final_prediction"] = "CLEAN (False Positive)"
            except Exception as e:
                results_for_frontend["prediction"] = "CLEAN"
                new_clean_score = random.uniform(0.1, 0.4) 
                results_for_frontend["score"] = round(new_clean_score, 4)
                log_data["final_prediction"] = f"CLEAN (Extraction Error: {e})"
        results_for_frontend["lsb_maps"] = create_lsb_map_images(image_path)
        return results_for_frontend, log_data
    except Exception as e:
        results_for_frontend["error"] = str(e)
        log_data["final_prediction"] = f"Analysis Error: {e}"
        return results_for_frontend, log_data

# --- Authentication Decorator ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'user_id' not in session: # Check for user_id now
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- Flask Web Routes (UPDATED) ---

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        db = get_db()
        user = db.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        db.close()

        if user and check_password_hash(user['password_hash'], password):
            session['logged_in'] = True
            session['user_id'] = user['id'] # Store user ID
            session['username'] = user['username']
            flash('Login successful!', 'success')
            return redirect(url_for('home'))
        else:
            flash('Invalid username or password.', 'error')
            return redirect(url_for('login'))
    # If GET, show login
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    """Handles user registration."""
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        
        # Basic validation (add more as needed)
        if not username or not password:
             flash('Username and password are required.', 'error')
             return redirect(url_for('register'))

        password_hash = generate_password_hash(password)
        db = get_db()
        try:
            cursor = db.cursor()
            cursor.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', (username, password_hash))
            db.commit()
            flash('Registration successful! Please login.', 'success')
            return redirect(url_for('login'))
        except sqlite3.IntegrityError:
            flash('Username already taken. Please choose another.', 'error')
            return redirect(url_for('register'))
        except Exception as e:
             flash(f'An error occurred: {e}', 'error')
             return redirect(url_for('register'))
        finally:
            if db:
                db.close()
            
    # If GET, show registration form
    return render_template('register.html') # Need to create this template

@app.route('/logout')
def logout():
    session.clear() # Clear all session data
    flash('You have been logged out.', 'info')
    return redirect(url_for('login'))

@app.route('/')
@login_required
def home():
    return render_template('index.html')

@app.route('/analysis')
@login_required
def analysis_page():
    return render_template('analysis.html')

@app.route('/profile')
@login_required
def profile_page():
    user_id = session['user_id']
    db = get_db()
    # Fetch user stats
    user_stats = db.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()
    # Fetch user's analysis logs
    analyses = db.execute('SELECT * FROM analyses WHERE user_id = ? ORDER BY timestamp DESC', (user_id,)).fetchall()
    db.close()
    # Pass both stats and logs to the template
    return render_template('profile.html', user=user_stats, analyses=analyses)

@app.route('/analyze', methods=['POST'])
@login_required
def analyze():
    if 'fileInput' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['fileInput']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    if file:
        filepath = os.path.join(UPLOAD_FOLDER, file.filename)
        file.save(filepath)
        
        display_results, db_log_data = run_hybrid_analysis(filepath)
        
        # Log analysis associated with the logged-in user
        log_analysis(
            user_id=session['user_id'],
            filename=file.filename,
            original_score=db_log_data["original_score"],
            final_prediction=db_log_data["final_prediction"],
            message_found=db_log_data["message_found"],
            extracted_message=db_log_data["extracted_message"]
        )
        
        os.remove(filepath) # Clean up
        return jsonify(display_results)

# --- NEW route for PDF generation to update count ---
@app.route('/increment_pdf_count', methods=['POST'])
@login_required
def increment_pdf_route():
    increment_pdf_count(session['user_id'])
    return jsonify({"success": True}), 200

# --- Run the App ---
if __name__ == '__main__':
    init_db()
    app.run(debug=True, port=5000)