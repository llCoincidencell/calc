import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
}

export const Card: React.FC<CardProps> = ({ children, className = '', title }) => {
  return (
    <div className={`bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden ${className}`}>
      {title && (
        <div className="px-3 py-2 sm:px-4 sm:py-3 border-b border-gray-200 bg-gray-50/50">
          <h3 className="text-sm sm:text-base font-bold leading-5 text-gray-900 uppercase tracking-tight">{title}</h3>
        </div>
      )}
      <div className="p-3 sm:p-4">
        {children}
      </div>
    </div>
  );
};