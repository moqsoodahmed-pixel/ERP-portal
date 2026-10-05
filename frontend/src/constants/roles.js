export const ROLES = Object.freeze({
  MASTER_ADMIN: 'MASTER_ADMIN',
  CLIENT_ADMIN: 'CLIENT_ADMIN',
  CLIENT_USER: 'CLIENT_USER',
  GST_VENDOR: 'GST_VENDOR',
});

export const roleHome = (role) => {
  switch (role) {
    case ROLES.MASTER_ADMIN: return '/master/dashboard';
    case ROLES.CLIENT_ADMIN:
    case ROLES.CLIENT_USER: return '/client/dashboard';
    case ROLES.GST_VENDOR: return '/vendor/dashboard';
    default: return '/auth/login';
  }
};

export const ROLE_LABEL = {
  MASTER_ADMIN: 'Platform administrator',
  CLIENT_ADMIN: 'Business administrator',
  CLIENT_USER: 'Business user',
  GST_VENDOR: 'GST filing partner',
};
