from . import db
from flask_login import UserMixin
from sqlalchemy.sql import func
import enum
import uuid
from sqlalchemy.dialects.postgresql import UUID, JSONB


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
    CLASSIFYING = 'classifying'
    CLASSIFIED = 'classified'
    EXTRACTED = 'extracted'
    NORMALIZED = 'normalized'
    LINKED = 'linked'
    VECTORIZED = 'vectorized'
    COMPLETED = 'completed'
    FAILED = 'failed'

# Enum for project status
class ProjectStatus(enum.Enum):
    ACTIVE = 'active'
    NEGOTIATING = 'negotiating'
    ARCHIVED = 'archived'


class User(db.Model, UserMixin):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(150), unique=True)
    password = db.Column(db.String(150), nullable=True) # Password can be null until user registers
    first_name = db.Column(db.String(150))
    company_name = db.Column(db.String(150))
    company_website = db.Column(db.String(200))
    business_id = db.Column(UUID(as_uuid=True))

    # New fields for invite-only system
    role = db.Column(db.Enum(UserRole), default=UserRole.USER, nullable=False)
    status = db.Column(db.Enum(UserStatus), default=UserStatus.INVITED, nullable=False)
    invitation_token = db.Column(db.String(100), unique=True)
    invitation_token_expires = db.Column(db.DateTime(timezone=True))
    documents = db.relationship('Document', backref='uploader', lazy=True)


class Document(db.Model):
    __tablename__ = 'documents'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    original_filename = db.Column(db.String(255), nullable=False)
    s3_path = db.Column(db.String(1024), nullable=False, unique=True)
    file_type = db.Column(db.String(100))
    file_size = db.Column(db.Integer) # Size in bytes
    business_id = db.Column(UUID(as_uuid=True), nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=func.now())
    status = db.Column(db.Enum(DocumentStatus), nullable=False, default=DocumentStatus.UPLOADED)
    
    # Classification fields
    classification_type = db.Column(db.String(100))  # valuation_report, market_appraisal, other_documents
    classification_confidence = db.Column(db.Float)
    classification_reasoning = db.Column(db.Text, nullable=True)  # Classification reasoning (may not exist in all DB schemas)
    classification_timestamp = db.Column(db.DateTime(timezone=True))
    parsed_text = db.Column(db.Text)  # Store full LlamaParse output
    extracted_json = db.Column(db.Text)  # Store extracted data as JSON
    metadata_json = db.Column(db.Text)  # Store additional metadata (e.g., filename address)
    
    # Property linking
    property_id = db.Column(UUID(as_uuid=True), db.ForeignKey('properties.id'))
    
    # Foreign Key to User who uploaded the file
    uploaded_by_user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    
    # New relationships for property-centric view
    property_relationships = db.relationship('DocumentRelationship', back_populates='document')

    def __repr__(self):
        return f'<Document {self.original_filename}>'

    def serialize(self):
        return {
            'id': self.id,
            'original_filename': self.original_filename,
            's3_path': self.s3_path,
            'file_type': self.file_type,
            'file_size': self.file_size,
            'business_id': str(self.business_id),
            'created_at': self.created_at.isoformat(),
            'status': self.status.name,
            'uploaded_by_user_id': self.uploaded_by_user_id
        }

class DocumentProcessingHistory(db.Model):
    """Audit trail for document processing pipeline steps"""
    __tablename__ = 'document_processing_history'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Foreign key to documents
    document_id = db.Column(UUID(as_uuid=True), db.ForeignKey('documents.id'), nullable=False)

    # Step information
    step_name = db.Column(db.String(100), nullable=False)
    step_status = db.Column(db.String(50), nullable=False)
    step_message = db.Column(db.Text)

    # Timing
    started_at =db.Column(db.DateTime(timezone=True), nullable=False)
    completed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    duration_seconds = db.Column(db.Integer, nullable=True)

    # Additional metadata
    step_metadata = db.Column(db.JSON, nullable=True)

    # Relationships
    document = db.relationship('Document', backref='processing_history')
    
    def __repr__(self):
        return f'<DocumentProcessingHistory {self.step_name}>'

    def serialize(self):
        return {
            'id': str(self.id),
            'document_id': str(self.document_id),
            'step_name': self.step_name,
            'step_status': self.step_status,
            'step_message': self.step_message,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'duration_seconds': self.duration_seconds,
            'step_metadata': self.step_metadata
        }




class Property(db.Model):
    """Unified property node - central hub for all documents"""
    __tablename__ = 'properties'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    address_hash = db.Column(db.String(64), unique=True, index=True)
    normalized_address = db.Column(db.String(500))
    formatted_address = db.Column(db.String(500))
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    business_id = db.Column(UUID(as_uuid=True), nullable=False, index=True)
    created_at = db.Column(db.DateTime(timezone=True), default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), default=func.now(), onupdate=func.now())
    last_enrichment_at = db.Column(db.DateTime(timezone=True))
    completeness_score = db.Column(db.Float, default=0.0)
    
    # Relationships
    documents = db.relationship('Document', backref='linked_property')
    document_relationships = db.relationship('DocumentRelationship', back_populates='property')
    details = db.relationship('PropertyDetails', uselist=False, back_populates='property')
    
    def __repr__(self):
        return f'<Property {self.formatted_address or self.normalized_address}>'
    
    def serialize(self):
        return {
            'id': str(self.id),
            'address_hash': self.address_hash,
            'normalized_address': self.normalized_address,
            'formatted_address': self.formatted_address,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'business_id': str(self.business_id),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'last_enrichment_at': self.last_enrichment_at.isoformat() if self.last_enrichment_at else None,
            'completeness_score': self.completeness_score,
            'document_count': len(self.documents) if self.documents else 0,
            'details': self.details.serialize() if self.details else None
        }




class PropertyDetails(db.Model):
    """Enriched property details from multiple documents"""
    __tablename__ = 'property_details'
    
    property_id = db.Column(UUID(as_uuid=True), db.ForeignKey('properties.id'), primary_key=True)
    property_type = db.Column(db.String(100))
    size_sqft = db.Column(db.Float)
    number_bedrooms = db.Column(db.Integer)
    number_bathrooms = db.Column(db.Integer)
    tenure = db.Column(db.String(50))
    epc_rating = db.Column(db.String(10))
    condition = db.Column(db.String(50))
    other_amenities = db.Column(db.Text)
    asking_price = db.Column(db.Float)
    sold_price = db.Column(db.Float)
    rent_pcm = db.Column(db.Float)
    last_transaction_date = db.Column(db.Date)
    last_valuation_date = db.Column(db.Date)
    data_sources = db.Column(db.JSON)  # Array of document IDs that contributed to this data
    data_quality_score = db.Column(db.Float, default=0.0)  # Score indicating quality of aggregated data
    last_enrichment = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    source_documents = db.Column(db.JSON, default=list)  # Array of document IDs that contributed to this data
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    property = db.relationship('Property', back_populates='details')
    
    def serialize(self):
        """Convert property details to dictionary"""
        return {
            'property_id': str(self.property_id),
            'property_type': self.property_type,
            'size_sqft': self.size_sqft,
            'number_bedrooms': self.number_bedrooms,
            'number_bathrooms': self.number_bathrooms,
            'tenure': self.tenure,
            'epc_rating': self.epc_rating,
            'condition': self.condition,
            'other_amenities': self.other_amenities,
            'asking_price': self.asking_price,
            'sold_price': self.sold_price,
            'rent_pcm': self.rent_pcm,
            'last_transaction_date': self.last_transaction_date.isoformat() if self.last_transaction_date else None,
            'last_valuation_date': self.last_valuation_date.isoformat() if self.last_valuation_date else None,
            'data_sources': self.data_sources,
            'data_quality_score': self.data_quality_score,
            'last_enrichment': self.last_enrichment.isoformat() if self.last_enrichment else None,
            'source_documents': self.source_documents
        }

class DocumentRelationship(db.Model):
    """Links between documents and properties"""
    __tablename__ = 'document_relationships'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id = db.Column(UUID(as_uuid=True), db.ForeignKey('documents.id'), nullable=False)
    property_id = db.Column(UUID(as_uuid=True), db.ForeignKey('properties.id'), nullable=False)
    relationship_type = db.Column(db.String(50), nullable=False)  # 'valuation', 'lease', 'offer', etc.
    address_source = db.Column(db.String(20), nullable=False)  # 'filename' or 'extraction'
    confidence_score = db.Column(db.Float)
    relationship_metadata = db.Column(db.JSON)  # Renamed from metadata to avoid SQLAlchemy conflict
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    last_updated = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    property = db.relationship('Property', back_populates='document_relationships')
    document = db.relationship('Document', back_populates='property_relationships')
    
    __table_args__ = (
        db.UniqueConstraint('document_id', 'property_id', name='uq_document_property_relationship'),
    )
    
    def serialize(self):
        """Convert relationship to dictionary"""
        return {
            'id': str(self.id),
            'document_id': str(self.document_id),
            'property_id': str(self.property_id),
            'relationship_type': self.relationship_type,
            'address_source': self.address_source,
            'confidence_score': self.confidence_score,
            'relationship_metadata': self.relationship_metadata,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'last_updated': self.last_updated.isoformat() if self.last_updated else None
        }


class PropertyCardCache(db.Model):
    """Cached property card summary data for instant rendering"""
    __tablename__ = 'property_card_cache'
    
    property_id = db.Column(UUID(as_uuid=True), db.ForeignKey('properties.id'), primary_key=True)
    card_data = db.Column(JSONB, nullable=False)  # Stores all card summary data as JSON
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    cache_version = db.Column(db.Integer, default=1, nullable=False)  # Increments on updates
    
    # Relationships
    property = db.relationship('Property', backref='card_cache')
    
    def __repr__(self):
        return f'<PropertyCardCache {self.property_id}>'
    
    def serialize(self):
        """Convert cache to dictionary"""
        return {
            'property_id': str(self.property_id),
            'card_data': self.card_data,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'cache_version': self.cache_version
        }


class Project(db.Model):
    """Projects for freelance/design work management"""
    __tablename__ = 'projects'
    
    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    
    # Client information
    client_name = db.Column(db.String(255), nullable=False)
    client_logo_url = db.Column(db.String(1024))
    
    # Project details
    title = db.Column(db.String(500), nullable=False)
    description = db.Column(db.Text)
    status = db.Column(db.Enum(ProjectStatus), default=ProjectStatus.ACTIVE, nullable=False)
    tags = db.Column(JSONB, default=list)  # Array of tag strings like ["Web Design", "Branding"]
    tool = db.Column(db.String(100))  # e.g., "Figma", "Sketch", "Adobe XD"
    
    # Budget (stored in cents for precision)
    budget_min = db.Column(db.Integer)  # Minimum budget in cents
    budget_max = db.Column(db.Integer)  # Maximum budget in cents
    
    # Timeline
    due_date = db.Column(db.DateTime(timezone=True))
    
    # Media
    thumbnail_url = db.Column(db.String(1024))
    
    # Engagement
    message_count = db.Column(db.Integer, default=0)
    
    # Timestamps
    created_at = db.Column(db.DateTime(timezone=True), server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # Relationships
    owner = db.relationship('User', backref='projects')
    
    def __repr__(self):
        return f'<Project {self.title}>'
    
    def serialize(self):
        """Convert project to dictionary"""
        return {
            'id': str(self.id),
            'user_id': self.user_id,
            'client_name': self.client_name,
            'client_logo_url': self.client_logo_url,
            'title': self.title,
            'description': self.description,
            'status': self.status.value if self.status else None,
            'tags': self.tags or [],
            'tool': self.tool,
            'budget_min': self.budget_min,
            'budget_max': self.budget_max,
            'due_date': self.due_date.isoformat() if self.due_date else None,
            'thumbnail_url': self.thumbnail_url,
            'message_count': self.message_count or 0,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }










