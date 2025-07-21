from celery import shared_task
import time
from .models import db, Document, DocumentStatus

@shared_task(bind=True)
def process_document_task(self, document_id):
    """
    A Celery task to process an uploaded document.
    """
    try:
        # Simulate a long-running process
        print(f"Starting document processing for document_id: {document_id}")
        document = Document.query.get(document_id)
        if not document:
            print(f"Document with id {document_id} not found.")
            return

        document.status = DocumentStatus.PROCESSING
        db.session.commit()

        # Simulate work being done
        time.sleep(10)

        # TODO: Add actual document processing logic here
        # - Download from S3
        # - Parse with LlamaParse
        # - Extract with LlamaExtract
        # - Store in AstraDB

        document.status = DocumentStatus.COMPLETED
        db.session.commit()
        print(f"Document processing completed for document_id: {document_id}")

    except Exception as e:
        print(f"Error processing document {document_id}: {e}")
        document.status = DocumentStatus.FAILED
        db.session.commit()
        # Handle retry logic if necessary
        raise self.retry(exc=e, countdown=60, max_retries=3) 