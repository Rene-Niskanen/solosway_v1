from . import db
from flask_login import UserMixin
from sqlalchemy.sql import func
import enum
import uuid
from sqlalchemy.dialects.postgresql import UUID


# Enum for user status
class UserStatus(enum.Enum):
    INVITED = 'invited'
    ACTIVE = 'active'
    DISABLED = 'disabled'

# Enum for user role
class UserRole(enum.Enum):
    USER = 'user'
    ADMIN = 'admin'

# Enum for document processing status
class DocumentStatus(enum.Enum):
    UPLOADED = 'uploaded'
    PROCESSING = 'processing'
    COMPLETED = 'completed'
    FAILED = 'failed'


class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(150), unique=True)
    password = db.Column(db.String(150), nullable=True) # Password can be null until user registers
    first_name = db.Column(db.String(150))
    company_name = db.Column(db.String(150))
    company_website = db.Column(db.String(200))
    appraisals = db.relationship('Appraisal')

    # New fields for invite-only system
    role = db.Column(db.Enum(UserRole), default=UserRole.USER, nullable=False)
    status = db.Column(db.Enum(UserStatus), default=UserStatus.INVITED, nullable=False)
    invitation_token = db.Column(db.String(100), unique=True)
    invitation_token_expires = db.Column(db.DateTime(timezone=True))
    documents = db.relationship('Document', backref='uploader', lazy=True)


class Document(db.Model):
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    original_filename = db.Column(db.String(255), nullable=False)
    s3_path = db.Column(db.String(1024), nullable=False, unique=True)
    file_type = db.Column(db.String(100))
    file_size = db.Column(db.Integer) # Size in bytes
    business_id = db.Column(db.String(150), nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=func.now())
    status = db.Column(db.Enum(DocumentStatus), nullable=False, default=DocumentStatus.UPLOADED)
    
    # Foreign Key to User who uploaded the file
    uploaded_by_user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    def __repr__(self):
        return f'<Document {self.original_filename}>'

    def serialize(self):
        return {
            'id': self.id,
            'original_filename': self.original_filename,
            's3_path': self.s3_path,
            'file_type': self.file_type,
            'file_size': self.file_size,
            'business_id': self.business_id,
            'created_at': self.created_at.isoformat(),
            'status': self.status.name,
            'uploaded_by_user_id': self.uploaded_by_user_id
        }


class Appraisal(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    address = db.Column(db.String(200), nullable=False)
    bedrooms = db.Column(db.Integer)
    bathrooms = db.Column(db.Integer)
    property_type = db.Column(db.String(50))
    land_size = db.Column(db.Float)
    floor_area = db.Column(db.Float)
    condition = db.Column(db.Integer)
    features = db.Column(db.String(500))  # Will store features as a comma-separated string
    status = db.Column(db.String(50), default='In Progress')
    date_created = db.Column(db.DateTime(timezone=True), default=func.now())
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    comparable_properties = db.relationship('ComparableProperty', backref='appraisal', lazy=True)
    chat_messages = db.relationship('ChatMessage', backref='appraisal', lazy=True)


class ComparableProperty(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    address = db.Column(db.String(200), nullable=False)
    postcode = db.Column(db.String(20))
    bedrooms = db.Column(db.Integer)
    bathrooms = db.Column(db.Integer)
    floor_area = db.Column(db.Float)
    image_url = db.Column(db.String(500))
    price = db.Column(db.Float)
    square_feet = db.Column(db.Float)
    days_on_market = db.Column(db.Integer)
    distance_to = db.Column(db.Float)
    location_adjustment = db.Column(db.Float, default=0.0)
    size_adjustment = db.Column(db.Float, default=0.0)
    market_adjustment = db.Column(db.Float, default=0.0)
    adjusted_value = db.Column(db.Float)
    appraisal_id = db.Column(db.Integer, db.ForeignKey('appraisal.id'), nullable=False)


class ChatMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.String(1000), nullable=False)
    is_user = db.Column(db.Boolean, default=True)
    timestamp = db.Column(db.DateTime(timezone=True), default=func.now())
    appraisal_id = db.Column(db.Integer, db.ForeignKey('appraisal.id'), nullable=False)


class PropertyData(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    external_id = db.Column(db.String(50), unique=True)  # e.g., "Z70132997"
    address = db.Column(db.String(200), nullable=False)
    postcode = db.Column(db.String(20))
    property_type = db.Column(db.String(50))
    bedrooms = db.Column(db.Integer)
    price = db.Column(db.Float)
    square_feet = db.Column(db.Float)
    days_on_market = db.Column(db.Integer)
    sstc = db.Column(db.Boolean, default=False)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    distance_to = db.Column(db.Float)
    summary = db.Column(db.Text)
    highest_offer = db.Column(db.Float)
    url = db.Column(db.String(500))
    date_added = db.Column(db.DateTime(timezone=True), default=func.now())
    
    # Foreign keys
    appraisal_id = db.Column(db.Integer, db.ForeignKey('appraisal.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    
    # Relationships
    appraisal = db.relationship('Appraisal', backref='property_data')
    user = db.relationship('User', backref='property_data')


class ExtractedProperty(db.Model):
    """Enhanced property model for PostgreSQL with geocoding support"""
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Basic property info
    property_address = db.Column(db.String(500), nullable=False)
    property_type = db.Column(db.String(100))
    number_bedrooms = db.Column(db.Integer)
    number_bathrooms = db.Column(db.Float)
    size_sqft = db.Column(db.Float)
    size_unit = db.Column(db.String(50))
    
    # Pricing info
    asking_price = db.Column(db.Float)
    sold_price = db.Column(db.Float)
    price_per_sqft = db.Column(db.Float)
    rent_pcm = db.Column(db.Float)
    yield_percentage = db.Column(db.Float)
    
    # Market info
    condition = db.Column(db.String(100))
    tenure = db.Column(db.String(100))
    lease_details = db.Column(db.Text)
    days_on_market = db.Column(db.Integer)
    transaction_date = db.Column(db.Date)
    sold_date = db.Column(db.Date)
    rented_date = db.Column(db.Date)
    leased_date = db.Column(db.Date)
    
    # Property features
    epc_rating = db.Column(db.String(10))
    listed_building_grade = db.Column(db.String(50))
    other_amenities = db.Column(db.Text)
    notes = db.Column(db.Text)
    
    # Geocoding
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    geocoded_address = db.Column(db.String(500))
    geocoding_confidence = db.Column(db.Float)
    geocoding_status = db.Column(db.String(50), default='pending')
    
    # Relationships
    source_document_id = db.Column(UUID(as_uuid=True), db.ForeignKey('document.id'))
    business_id = db.Column(db.String(150), nullable=False, index=True)
    extracted_at = db.Column(db.DateTime(timezone=True), default=func.now())
    
    # Relationships
    source_document = db.relationship('Document', backref='extracted_properties')
    
    def __repr__(self):
        return f'<ExtractedProperty {self.property_address}>'
    
    def serialize(self):
        return {
            'id': str(self.id),
            'property_address': self.property_address,
            'property_type': self.property_type,
            'number_bedrooms': self.number_bedrooms,
            'number_bathrooms': self.number_bathrooms,
            'size_sqft': self.size_sqft,
            'asking_price': self.asking_price,
            'sold_price': self.sold_price,
            'condition': self.condition,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'geocoded_address': self.geocoded_address,
            'extracted_at': self.extracted_at.isoformat() if self.extracted_at else None
        }







