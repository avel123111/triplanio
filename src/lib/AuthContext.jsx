import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  // Prevent race condition: track which user ID is currently being loaded
  const loadingForRef = React.useRef(null);

  useEffect(() => {
    // Use onAuthStateChange as the single source of truth.
    // It fires INITIAL_SESSION on mount (with current session or null),
    // then SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED on changes.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        // Deduplicate: skip if already loading/loaded for this user
        if (loadingForRef.current === session.user.id) return;
        loadingForRef.current = session.user.id;
        await loadUserProfile(session.user);
      } else {
        loadingForRef.current = null;
        setUser(null);
        setIsAuthenticated(false);
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (authUser) => {
    try {
      setIsLoadingAuth(true);

      // Fetch profile from public.users
      let { data: profile, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      if (error && error.code === 'PGRST116') {
        // Profile doesn't exist yet — create it (first login via Google or email)
        const seed = encodeURIComponent(
          authUser.user_metadata?.full_name ||
          authUser.user_metadata?.name ||
          authUser.email || 'user'
        );
        const avatarUrl = authUser.user_metadata?.avatar_url ||
          `https://api.dicebear.com/7.x/initials/svg?seed=${seed}`;

        const { data: newProfile, error: createError } = await supabase
          .from('users')
          .insert({
            id: authUser.id,
            email: authUser.email,
            full_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || '',
            avatar_url: avatarUrl,
          })
          .select()
          .single();

        if (createError) throw createError;
        profile = newProfile;
      } else if (error) {
        throw error;
      }

      // Backfill avatar if missing
      if (profile && !profile.avatar_url) {
        const seed = encodeURIComponent(profile.full_name || profile.email || 'user');
        const defaultAvatar = `https://api.dicebear.com/7.x/initials/svg?seed=${seed}`;
        await supabase.from('users').update({ avatar_url: defaultAvatar }).eq('id', authUser.id);
        profile.avatar_url = defaultAvatar;
      }

      setUser({ ...profile, id: authUser.id });
      setIsAuthenticated(true);
      setIsLoadingAuth(false);
      setAuthChecked(true);
    } catch (error) {
      console.error('Failed to load user profile:', error);
      setAuthError({ type: 'unknown', message: error.message });
      setIsAuthenticated(false);
      setIsLoadingAuth(false);
      setAuthChecked(true);
    }
  };

  const checkUserAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await loadUserProfile(session.user);
    }
  };

  const logout = async (shouldRedirect = true) => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    if (shouldRedirect) {
      window.location.href = '/login';
    }
  };

  const navigateToLogin = () => {
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,  // kept for interface compatibility
      authError,
      appPublicSettings: null,          // kept for interface compatibility
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState: checkUserAuth,     // alias for interface compatibility
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};