"""
Structured data retrieved using SQL on extracted properties
"""

import json
import logging 
from typing import List, Optional

from langchain_openai import ChatOpenAI

from backend.llm.config import config 
from backend.llm.types import RetrievedDocument 

logger = logging.getLogger(__name__)

class QueryParameter:
    """Parsed query parameter for SQL generation"""

    def __init__(self, column: str, operator: str, value, data_type: str) -> None:
        self.column = column
        self.operator = operator
        self.value = value
        self.data_type = data_type

class SQLDocumentRetriever:
    """Query structured document properties using LLM-generated SQL"""

    # Define queryable schema
    EXTRACTED_DATA_COLUMNS = {
        'bedrooms': 'integer', 
        'bathrooms': 'decimal',
        'square_feet': 'decimal',
        'year_built': 'integer',
        'price': 'decimal',
        'condition': 'text',
        'has_basement': 'boolean',
        'lot_size': 'decimal',
        'roof_type': 'text',
        'ac_type': 'text',
        'pool': 'boolean'
    }

    Document_properties = {
        'document_type': 'text',
        'classification_type': 'text',
        'created_date': 'timestamp',
        'status': 'text'
    }

    def __init__(self): 
        self.llm = ChatOpenAI(
            api_key=config.open_api_key,
            model=config.openai_model,
            temperature=0
        )

    def query_documents(
        self,
        user_query: str,
        top_k: int = 10
    ) -> List[RetrievedDocument]:
        """
        Convert natual language query to SQL and retrieve document.

        Args:
            user_query: Natural language query
            top_k: Max Number of results  to return

        Results:
            Lising of RetrievedDocument results
        """
        try: 
            # step one: Extract SQL parameters from natural language 
            parameters = self._extract_query_parameters(user_query)

            if not parameters:
                logger.info("No strutured parameters extracted from query")
                return []


            # step two: build parameterized SQL
            sql, query_params = self._build_sql_query(parameters)
            logger.info(f"Generated SQL: {sql}")

            # step three: Execute (you'll implement actual DB call)
            # for now, return an empty list - integrate with Supabase later
            results = self._execute_sql(sql, query_params, top_k)

            return results

        except Exception as e:
            logger.error(f"SQL retrieve failed: {e}")
            return []

    def _extraxt_query_parameters(self, user_query: str) -> List[QueryParameter]:
        """Use LLM to convert natural language query to structured parameters"""

        schema_description = {
            'extracted_data': self.EXTRACTED_DATA_COLUMNS,
            'document_properties': self.DOCUMENT_PROPERTIES
        }

        prompt = f"""Extract query parameters from this user query.

        Available columns:
        {json.dumps(schema_description, indent=2)}

        Rules:
        1. Each parameter should ap to a real column 
        2. Use operatiors: "=", ">", "<", "<=", ">=", "BETWEEN", "IN", "LIKE"
        3. For LIKE, use % wildcards
        4. For IN, return value as list
        5. Default to extracted_data for property attributes
        5. Return empty list if no structured filters detected 

        User Query: "{user_query}"

        Return ONLY valid JSON arry:
        [
            {{"column": "bedrooms", "operator": "=", "value" 3, "data_type": "extracted_data"}},
            {{"column": "price", "operator": "<", "value": 500000, "data_type": "extracted_data"}}
        ]"""

        response = self.llm.invoke(prompt)

        try:
            params_data = json.loads(response.content)
            parameters = [
                QueryParameter(
                    column=p['column'],
                    operator=p['operator'],
                    value=p['value'],
                    data_type=p['data_type']
                )
                for p in params_data
            ]
            return parameters
        except Exception as e:
            logger.error(f"Failed to parse query parameters: {e}")
            return []

def _build_sql_query(self, parameters: List[QueryParameter]) -> tuple[str, dict]:
        """Build parameterized SQL from extracted parameters"""
        
        # Validate columns exist
        valid_extracted = set(self.EXTRACTED_DATA_COLUMNS.keys())
        valid_docs = set(self.DOCUMENT_PROPERTIES.keys())
        
        for param in parameters:
            if param.data_type == 'extracted_data' and param.column not in valid_extracted:
                raise ValueError(f"Invalid extracted_data column: {param.column}")
            elif param.data_type == 'document_properties' and param.column not in valid_docs:
                raise ValueError(f"Invalid document column: {param.column}")
        
        # Separate by table
        extracted_filters = [p for p in parameters if p.data_type == 'extracted_data']
        doc_filters = [p for p in parameters if p.data_type == 'document_properties']
        
        where_conditions = []
        query_params = {}
        param_counter = 0
        
        # Build WHERE clauses for document properties
        for param in doc_filters:
            col = param.column
            op = param.operator
            
            if op == 'BETWEEN':
                where_conditions.append(f"doc.{col} BETWEEN %s AND %s")
                query_params[f'doc_{param_counter}'] = param.value[0]
                query_params[f'doc_{param_counter + 1}'] = param.value[1]
                param_counter += 2
            elif op == 'IN':
                placeholders = ', '.join(['%s'] * len(param.value))
                where_conditions.append(f"doc.{col} IN ({placeholders})")
                for i, val in enumerate(param.value):
                    query_params[f'doc_{param_counter + i}'] = val
                param_counter += len(param.value)
            elif op in ['LIKE', 'CONTAINS']:
                where_conditions.append(f"doc.{col} LIKE %s")
                query_params[f'doc_{param_counter}'] = param.value
                param_counter += 1
            else:
                where_conditions.append(f"doc.{col} {op} %s")
                query_params[f'doc_{param_counter}'] = param.value
                param_counter += 1
        
        # Build WHERE clauses for extracted data
        for param in extracted_filters:
            col = param.column
            op = param.operator
            
            if op == 'BETWEEN':
                where_conditions.append(f"ext.{col} BETWEEN %s AND %s")
                query_params[f'ext_{param_counter}'] = param.value[0]
                query_params[f'ext_{param_counter + 1}'] = param.value[1]
                param_counter += 2
            elif op == 'IN':
                placeholders = ', '.join(['%s'] * len(param.value))
                where_conditions.append(f"ext.{col} IN ({placeholders})")
                for i, val in enumerate(param.value):
                    query_params[f'ext_{param_counter + i}'] = val
                param_counter += len(param.value)
            elif op in ['LIKE', 'CONTAINS']:
                where_conditions.append(f"ext.{col} LIKE %s")
                query_params[f'ext_{param_counter}'] = param.value
                param_counter += 1
            else:
                where_conditions.append(f"ext.{col} {op} %s")
                query_params[f'ext_{param_counter}'] = param.value
                param_counter += 1
        
        where_clause = ' AND '.join(where_conditions) if where_conditions else '1=1'
        join_clause = 'LEFT JOIN document_extracted_data ext ON doc.doc_id = ext.doc_id' if extracted_filters else ''
        
        sql = f"""
        SELECT DISTINCT doc.doc_id, doc.property_id, doc.classification_type, ext.*
        FROM documents doc
        {join_clause}
        WHERE {where_clause}
        LIMIT 50
        """

    

