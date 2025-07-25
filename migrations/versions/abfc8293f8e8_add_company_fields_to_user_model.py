"""Add company fields to User model

Revision ID: abfc8293f8e8
Revises: e8ea11e7475a
Create Date: 2025-07-07 17:00:51.347998

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'abfc8293f8e8'
down_revision = 'e8ea11e7475a'
branch_labels = None
depends_on = None


def upgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.add_column(sa.Column('company_name', sa.String(length=150), nullable=True))
        batch_op.add_column(sa.Column('company_website', sa.String(length=200), nullable=True))

    # ### end Alembic commands ###


def downgrade():
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('user', schema=None) as batch_op:
        batch_op.drop_column('company_website')
        batch_op.drop_column('company_name')

    # ### end Alembic commands ###
